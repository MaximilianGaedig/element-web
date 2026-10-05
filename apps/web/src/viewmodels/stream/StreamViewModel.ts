/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import {
    ClientEvent,
    Direction,
    EventType,
    KnownMembership,
    MatrixEventEvent,
    RelationType,
    RoomEvent,
    type MatrixClient,
    type MatrixEvent,
    type Room,
} from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";
import {
    BACKWARD_LOADING_KEY,
    BaseViewModel,
    type ImmediateScroll,
    type TimelineItem,
    type TimelineViewActions,
    type TimelineViewSnapshot,
} from "@element-hq/web-shared-components";

import { wantsDateSeparator } from "../../DateUtils";
import { isRoomVisible } from "../../stores/room-list-v3/isRoomVisible";
import { DefaultTagID } from "../../stores/room-list-v3/skip-list/tag";
import { mergeStream, roomsToPaginate, streamBound, type StreamSource } from "./streamMerge";

/** Messages of one sender closer together than this read as one run, without the name repeated. */
const CONTINUATION_MAX_INTERVAL = 5 * 60 * 1000;

/** How many messages the first screen wants before it stops paging rooms back. */
const INITIAL_FILL = 40;
/** How many more messages one reach of the top tries to bring in. */
const PAGE_FILL = 30;
/** How many messages each room is asked for per page. */
const ROOM_PAGE_SIZE = 30;
/** How many rooms are paged at once: enough to move the bound, few enough not to flood the server. */
const ROOMS_PER_ROUND = 4;
/** How many rounds one reach of the top may take, so a stretch where nothing was said ends. */
const MAX_ROUNDS = 6;
/**
 * How many times the list pages back on its own to fill the first screen. Past that it waits for the reader
 * to scroll up: an account whose rooms say little would otherwise page every room it has.
 */
const MAX_AUTO_FILLS = 2;
/** How long changes are gathered before the list is rebuilt: one sync touches many rooms at once. */
const REBUILD_DELAY_MS = 16;

const POLL_START_TYPES = new Set(["m.poll.start", "org.matrix.msc3381.poll.start"]);

/** Whether an event is a message the Stream shows: what a person said, not changes to the room or to other messages. */
export function isStreamMessage(event: MatrixEvent): boolean {
    if (event.isState() || event.isRedacted()) return false;
    const type = event.getType();
    if (
        type !== EventType.RoomMessage &&
        type !== EventType.Sticker &&
        type !== EventType.RoomMessageEncrypted &&
        !POLL_START_TYPES.has(type)
    ) {
        return false;
    }
    // The wire content, as an encrypted event's relation is readable before it is decrypted: an edit or a
    // reaction is not a message of its own, whether or not its keys have arrived.
    const relType = event.getWireContent()["m.relates_to"]?.rel_type;
    return relType !== RelationType.Replace && relType !== RelationType.Annotation && relType !== RelationType.Thread;
}

/** Whether a room's messages belong in the Stream: rooms the reader is in and has not put aside. */
function isStreamRoom(room: Room): boolean {
    return (
        room.getMyMembership() === KnownMembership.Join && isRoomVisible(room) && !room.tags[DefaultTagID.LowPriority]
    );
}

/** What the view needs to draw one message row, beyond its key. */
export interface StreamRowInfo {
    event: MatrixEvent;
    room: Room;
    /** The first message of a run from this room: the row carries the room's bar. */
    runStart: boolean;
}

export interface StreamViewModelProps {
    client: MatrixClient;
}

/**
 * The Stream: messages from every room the reader is in, merged by time (MEO-44).
 *
 * It holds no copy of any room's history. It reads the rooms' own live timelines, which the chat list's sync
 * already fills with each room's latest messages, and pages a room back only when that room is what keeps
 * the list from reaching further back (see streamMerge). The pages land in the room itself, so opening the
 * room afterwards finds them already there.
 *
 * Reading the Stream does not mark rooms as read and sends no receipts: a message scrolled past here has
 * not been answered, and a bridged contact must not be told it was seen.
 */
export class StreamViewModel
    extends BaseViewModel<TimelineViewSnapshot, StreamViewModelProps>
    implements TimelineViewActions
{
    private readonly rows = new Map<string, StreamRowInfo>();
    private readonly itemCache = new Map<string, TimelineItem>();
    /** Rooms that failed to page; left out of paging until the Stream is opened again, so one bad room cannot loop. */
    private readonly failedRooms = new Set<string>();
    private sources: StreamSource[] = [];
    private bound = -Infinity;
    private rebuildTimer: number | null = null;
    private paging = false;
    private built = false;
    private autoFills = 0;
    private isAtBottom = true;
    /** The newest message's time when the reader left the bottom; what arrives after it counts as new. */
    private leftBottomAtTs: number | null = null;

    public constructor(props: StreamViewModelProps) {
        super(props, {
            items: [],
            atLiveEnd: true,
            pendingAnchor: null,
            highlightedEventId: null,
            isAtBottom: true,
            canJumpToReadMarker: false,
            numUnreadMessages: 0,
            hasHighlights: false,
            unreadMentions: 0,
            unreadReactions: 0,
        });
        const { client } = props;
        // The client re-emits every room's events, so one set of listeners covers all of them.
        const listen = (event: string, cb: unknown): void =>
            this.disposables.trackListener(client, event, cb as (...args: unknown[]) => void);
        listen(RoomEvent.Timeline, this.onTimeline);
        listen(RoomEvent.TimelineReset, this.scheduleRebuild);
        listen(RoomEvent.Redaction, this.scheduleRebuild);
        listen(RoomEvent.MyMembership, this.scheduleRebuild);
        listen(RoomEvent.Tags, this.scheduleRebuild);
        listen(ClientEvent.Room, this.scheduleRebuild);
        listen(MatrixEventEvent.Decrypted, this.onDecrypted);
        this.disposables.track(() => {
            if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer);
        });
        /*
         * The first rows are published just after the view has mounted rather than in it, as the room timeline's
         * are. The shared timeline places its first rows once, from its mount; rows already there at mount are
         * lost when React runs the mount twice (StrictMode in development), and the list stays hidden.
         */
        this.scheduleRebuild();
    }

    /** The message behind a row, its room and whether it opens a run; undefined for other rows. */
    public getRow(key: string): StreamRowInfo | undefined {
        return this.rows.get(key);
    }

    // ── Listeners ─────────────────────────────────────────────────────

    private readonly onTimeline = (
        event: MatrixEvent,
        room: Room | undefined,
        toStartOfTimeline: boolean | undefined,
    ): void => {
        // Pages fetched by the Stream itself are rebuilt once they are all in; older history paged by an open
        // room does not change what is shown until it reaches the bound.
        if (toStartOfTimeline || !room) return;
        if (event.getTs() < this.bound) return;
        this.scheduleRebuild();
    };

    private readonly onDecrypted = (event: MatrixEvent): void => {
        // A decrypted reaction or edit leaves the list; one far below the list changes nothing in it.
        if (this.rows.has(event.getId() ?? "") || event.getTs() >= this.bound) this.scheduleRebuild();
    };

    private readonly scheduleRebuild = (): void => {
        if (this.rebuildTimer !== null || this.isDisposed) return;
        this.rebuildTimer = window.setTimeout(() => {
            this.rebuildTimer = null;
            if (!this.isDisposed) this.rebuild();
        }, REBUILD_DELAY_MS);
    };

    // ── Building the list ─────────────────────────────────────────────

    /**
     * Rebuild the list from the rooms. Two passes so the cost follows what is shown rather than what is loaded:
     * the bound comes from each room's oldest loaded event, and only the events at or after it are read.
     */
    private rebuild(): void {
        const started = performance.now();
        const rooms = this.props.client
            .getRooms()
            .filter(isStreamRoom)
            .sort((a, b) => (a.roomId < b.roomId ? -1 : a.roomId > b.roomId ? 1 : 0));
        const byRoom = new Map<string, Room>();
        const sources: StreamSource[] = [];
        for (const room of rooms) {
            const timeline = room.getLiveTimeline();
            const events = timeline.getEvents();
            byRoom.set(room.roomId, room);
            sources.push({
                roomId: room.roomId,
                events: [],
                oldestLoadedTs: events.length ? events[0].getTs() : undefined,
                canPaginateBack:
                    !this.failedRooms.has(room.roomId) && timeline.getPaginationToken(Direction.Backward) !== null,
            });
        }
        const bound = streamBound(sources);

        const eventsById = new Map<string, MatrixEvent>();
        for (const source of sources) {
            const events = byRoom.get(source.roomId)!.getLiveTimeline().getEvents();
            let start = events.length;
            while (start > 0 && events[start - 1].getTs() >= bound) start--;
            for (let i = start; i < events.length; i++) {
                const event = events[i];
                const eventId = event.getId();
                if (!eventId || !isStreamMessage(event)) continue;
                source.events.push({ eventId, ts: event.getTs(), sender: event.getSender() ?? "" });
                eventsById.set(eventId, event);
            }
        }

        const entries = mergeStream(sources, bound);
        this.sources = sources;
        this.bound = bound;

        this.rows.clear();
        const items: TimelineItem[] = [];
        if (this.paging) items.push({ kind: "loading", key: BACKWARD_LOADING_KEY });
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const prev = entries[i - 1];
            const next = entries[i + 1];
            const newDay = !prev || wantsDateSeparator(new Date(prev.ts), new Date(entry.ts));
            if (newDay) items.push(this.cached({ kind: "date-separator", key: `date-${entry.eventId}`, ts: entry.ts }));
            const runStart = newDay || prev.roomId !== entry.roomId;
            const continuation = !runStart && continues(prev, entry);
            const nextContinues =
                !!next &&
                next.roomId === entry.roomId &&
                !wantsDateSeparator(new Date(entry.ts), new Date(next.ts)) &&
                continues(entry, next);
            items.push(this.cached({ kind: "event", key: entry.eventId, continuation, lastInSection: !nextContinues }));
            this.rows.set(entry.eventId, {
                event: eventsById.get(entry.eventId)!,
                room: byRoom.get(entry.roomId)!,
                runStart,
            });
        }
        this.pruneCache(items);

        const canPage = sources.some((s) => s.canPaginateBack && s.oldestLoadedTs !== undefined);
        const first = !this.built && items.length > 0;
        if (first) this.built = true;
        this.snapshot.merge({
            items,
            isEmpty: entries.length === 0 && !canPage && !this.paging,
            numUnreadMessages: this.countNewBelow(entries),
            // Open at the newest message, as a chat opens at its end.
            ...(first ? { pendingAnchor: { targetKey: items[items.length - 1].key, align: "end" as const } } : {}),
        });

        const took = performance.now() - started;
        if (took > 8)
            logger.info(
                `Stream: rebuilt ${entries.length} messages from ${rooms.length} rooms in ${Math.round(took)} ms`,
            );

        if (entries.length < INITIAL_FILL && canPage && !this.paging && this.autoFills < MAX_AUTO_FILLS) {
            this.autoFills++;
            void this.pageBack(INITIAL_FILL - entries.length);
        }
    }

    /** The same item object as last time when nothing about it changed, so rows that did not change are not redrawn. */
    private cached(item: TimelineItem): TimelineItem {
        const previous = this.itemCache.get(item.key);
        if (previous && sameItem(previous, item)) return previous;
        this.itemCache.set(item.key, item);
        return item;
    }

    private pruneCache(items: TimelineItem[]): void {
        if (this.itemCache.size <= items.length) return;
        const keep = new Set(items.map((i) => i.key));
        for (const key of this.itemCache.keys()) if (!keep.has(key)) this.itemCache.delete(key);
    }

    private countNewBelow(entries: Array<{ ts: number }>): number {
        if (this.isAtBottom || this.leftBottomAtTs === null) return 0;
        let count = 0;
        for (let i = entries.length - 1; i >= 0 && entries[i].ts > this.leftBottomAtTs; i--) count++;
        return count;
    }

    // ── Paging ────────────────────────────────────────────────────────

    /**
     * Page back the rooms holding the bound until `wanted` more messages are in, or nothing more moves it.
     * A few rooms at a time: each page moves its room's oldest message back, and the next room in line
     * becomes the bound.
     */
    private async pageBack(wanted: number): Promise<void> {
        if (this.paging || this.isDisposed) return;
        this.paging = true;
        this.rebuild();
        const before = this.rows.size;
        const started = performance.now();
        let requests = 0;
        try {
            for (let round = 0; round < MAX_ROUNDS && !this.isDisposed; round++) {
                const targets = roomsToPaginate(this.sources, ROOMS_PER_ROUND);
                if (targets.length === 0) break;
                requests += targets.length;
                await Promise.all(targets.map((roomId) => this.pageRoom(roomId)));
                if (this.isDisposed) return;
                this.rebuild();
                if (this.rows.size - before >= wanted) break;
            }
        } finally {
            this.paging = false;
            if (!this.isDisposed) this.rebuild();
            // What decides whether paging should move to the server (MEO-44): pages taken and the time they took.
            logger.info(
                `Stream: paged back ${requests} room pages in ${Math.round(performance.now() - started)} ms, ` +
                    `${this.rows.size - before} more messages`,
            );
        }
    }

    private async pageRoom(roomId: string): Promise<void> {
        const room = this.props.client.getRoom(roomId);
        if (!room) return;
        try {
            await this.props.client.paginateEventTimeline(room.getLiveTimeline(), {
                backwards: true,
                limit: ROOM_PAGE_SIZE,
            });
        } catch (e) {
            logger.warn(`Stream: could not page back ${roomId}`, e);
            this.failedRooms.add(roomId);
        }
    }

    // ── TimelineViewActions ───────────────────────────────────────────

    public onStartReached = (): void => {
        void this.pageBack(PAGE_FILL);
    };

    /** The Stream always ends at the newest message: there is nothing to load after it. */
    public onEndReached = (): void => {};

    public onAnchorReached = (): void => {
        this.snapshot.merge({ pendingAnchor: null });
    };

    /** No read receipts from the Stream (see the class comment), so nothing to track. */
    public onVisibleRangeChanged = (): void => {};

    public onAtBottomStateChange = (atBottom: boolean): void => {
        this.isAtBottom = atBottom;
        if (atBottom) {
            this.leftBottomAtTs = null;
        } else if (this.leftBottomAtTs === null) {
            const last = [...this.rows.values()].at(-1);
            this.leftBottomAtTs = last?.event.getTs() ?? Date.now();
        }
        this.snapshot.merge({
            isAtBottom: atBottom,
            numUnreadMessages: atBottom ? 0 : this.snapshot.current.numUnreadMessages,
        });
    };

    public onJumpToLive = (scrollNow: ImmediateScroll): void => {
        const items = this.snapshot.current.items;
        if (items.length) scrollNow({ targetKey: items[items.length - 1].key, align: "end" });
    };

    // The Stream has no read marker, mention or reaction counters (canJumpToReadMarker and the counts stay
    // at false and 0), so the view never offers these.
    public onJumpToReadMarker = (): void => {};
    public onMarkAllAsRead = (): void => {};
    public onJumpToUnreadMention = (): void => {};
    public onJumpToUnreadReaction = (): void => {};
}

function continues(prev: { sender: string; ts: number }, next: { sender: string; ts: number }): boolean {
    return prev.sender === next.sender && next.ts - prev.ts < CONTINUATION_MAX_INTERVAL;
}

function sameItem(a: TimelineItem, b: TimelineItem): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === "event" && b.kind === "event") {
        return a.continuation === b.continuation && a.lastInSection === b.lastInSection;
    }
    if (a.kind === "date-separator" && b.kind === "date-separator") return a.ts === b.ts;
    return true;
}
