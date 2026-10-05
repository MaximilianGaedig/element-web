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
    ReceiptType,
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
import SettingsStore from "../../settings/SettingsStore";
import UserActivity from "../../UserActivity";
import Timer from "../../utils/Timer";
import { isRoomVisible } from "../../stores/room-list-v3/isRoomVisible";
import { DefaultTagID } from "../../stores/room-list-v3/skip-list/tag";
import { mergeStream, roomsToPaginate, streamBound, type StreamSource } from "./streamMerge";

/** Messages of one sender closer together than this read as one run, without the name repeated. */
const CONTINUATION_MAX_INTERVAL = 5 * 60 * 1000;

/** How many messages the first screen wants before it stops paging rooms back. */
const INITIAL_FILL = 40;
/** How many more messages one reach of the top tries to bring in. */
const PAGE_FILL = 30;
/** How many loads in a row that bring no messages the list goes through on its own before waiting for the reader. */
const MAX_EMPTY_LOADS = 3;
/** How many pages in a row that add nothing to a room leave it out of loading. */
const MAX_EMPTY_PAGES = 3;
/** How many messages each room is asked for per page. */
const ROOM_PAGE_SIZE = 30;
/** How many rooms are paged at once: enough to move the bound, few enough not to flood the server. */
const ROOMS_PER_ROUND = 4;
/** How many rounds one reach of the top may take, so a stretch where nothing was said ends. */
const MAX_ROUNDS = 6;
/**
 * How many times the list pages back on its own to fill the first screen before showing it. Past that it shows
 * what it has: an account whose rooms say little would otherwise page every room it has.
 */
const MAX_AUTO_FILLS = 2;
/** How long changes are gathered before the list is rebuilt: one sync touches many rooms at once. */
const REBUILD_DELAY_MS = 16;

/**
 * How long a message has to stay fully on screen, with the list at rest, before its room counts as read up to it.
 * Longer than a chat's own (200 ms there): here the reader is skimming many conversations, and a bridged contact
 * is told "seen" by it.
 */
const READ_DWELL_MS = 1000;

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
 * Reading here marks rooms as read the way reading a chat does, but only for what was actually read: a room's
 * receipt moves to its last message that stayed fully on screen while the list was at rest (READ_DWELL_MS), so
 * scrolling past a conversation does not tell its people it was seen.
 */
export class StreamViewModel
    extends BaseViewModel<TimelineViewSnapshot, StreamViewModelProps>
    implements TimelineViewActions
{
    private readonly rows = new Map<string, StreamRowInfo>();
    private readonly itemCache = new Map<string, TimelineItem>();
    /** Rooms that failed to page or whose pages do not move them; left out until the Stream is opened again. */
    private readonly failedRooms = new Set<string>();
    /** Pages in a row, per room, that added no events. */
    private readonly emptyPages = new Map<string, number>();
    private sources: StreamSource[] = [];
    private bound = -Infinity;
    private rebuildTimer: number | null = null;
    private paging = false;
    private built = false;
    private autoFills = 0;
    private isAtBottom = true;
    /** The top of the list is on screen: the view does not ask again while it stays there, so loading carries on. */
    private atTop = false;
    /** Per room, the last message fully on screen in the latest visible range: what would be marked read. */
    private readable = new Map<string, MatrixEvent>();
    private readTimer: number | null = null;
    /** The last visible range the view reported: start, end, and the last row fully on screen. */
    private lastRange: [number, number, number] | null = null;
    /** Waiting for the reader to be back before marking anything read. */
    private awayTimer: Timer | null = null;
    /** Loads in a row, since the reader last reached the top, that brought no messages. */
    private emptyLoads = 0;
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
            if (this.readTimer !== null) window.clearTimeout(this.readTimer);
            this.awayTimer?.abort();
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
                oldestLoadedTs: hiddenUpTo(room, events),
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

        const canPage = this.canPage();
        if (!this.built && entries.length < INITIAL_FILL && canPage) {
            /*
             * Too few for a first screen: fill it before showing anything, as the room timeline does. The view
             * keeps the reader at the newest message by adjusting the scroll position as rows land above, and a
             * list shorter than the window has none to adjust, so rows added after it is shown would leave the
             * reader far above the newest message.
             */
            if (!this.paging && this.autoFills < MAX_AUTO_FILLS) {
                this.autoFills++;
                void this.pageBack(INITIAL_FILL - entries.length);
                return;
            }
            if (this.paging) return;
        }
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
    }

    /** Whether any room has older history to load that can move the list back. */
    private canPage(): boolean {
        return this.sources.some((s) => s.canPaginateBack && s.oldestLoadedTs !== undefined);
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
            if (!this.isDisposed) {
                this.rebuild();
                /*
                 * A stretch where the rooms paged said nothing that is shown (only changes to the rooms) adds no
                 * rows, so the view, still at the top, has no reason to ask again. Carry on while the reader is
                 * there and there is more to load.
                 */
                const added = this.rows.size - before;
                this.emptyLoads = added > 0 ? 0 : this.emptyLoads + 1;
                // Not without end: after a few loads that brought nothing, wait for the reader to scroll again.
                if (this.built && this.atTop && added < wanted && this.emptyLoads < MAX_EMPTY_LOADS && this.canPage()) {
                    window.setTimeout(() => void this.pageBack(PAGE_FILL), 0);
                }
            }
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
        const timeline = room.getLiveTimeline();
        const firstBefore = timeline.getEvents()[0]?.getId();
        try {
            await this.props.client.paginateEventTimeline(timeline, { backwards: true, limit: ROOM_PAGE_SIZE });
        } catch (e) {
            logger.warn(`Stream: could not page back ${roomId}`, e);
            this.failedRooms.add(roomId);
            return;
        }
        if (room.getLiveTimeline() !== timeline) return;
        /*
         * A page that adds nothing can be a step on the way (from the stored history over to the server's), but
         * a room whose pages keep adding nothing would be asked for again on every round, holding the list up for
         * good. Seen on a real account (MEO-44): the stored history handed back the same few positions in turn,
         * so the token changed on every page and nothing was ever added. Leave such a room out until the Stream
         * is opened again.
         */
        if (timeline.getEvents()[0]?.getId() !== firstBefore) {
            this.emptyPages.delete(roomId);
            return;
        }
        const empty = (this.emptyPages.get(roomId) ?? 0) + 1;
        this.emptyPages.set(roomId, empty);
        if (empty >= MAX_EMPTY_PAGES && timeline.getPaginationToken(Direction.Backward) !== null) {
            logger.warn(`Stream: paging back ${roomId} adds nothing; leaving it out`);
            this.failedRooms.add(roomId);
        }
    }

    // ── TimelineViewActions ───────────────────────────────────────────

    public onStartReached = (): void => {
        this.emptyLoads = 0;
        void this.pageBack(PAGE_FILL);
    };

    /** The Stream always ends at the newest message: there is nothing to load after it. */
    public onEndReached = (): void => {};

    public onAnchorReached = (): void => {
        if (this.snapshot.current.pendingAnchor === null) return;
        this.snapshot.merge({ pendingAnchor: null });
        // What is on screen once the list is placed starts being read now.
        if (this.lastRange) this.onVisibleRangeChanged(...this.lastRange);
    };

    /**
     * Tracks whether the top of the list is showing, and what is read: every range change restarts the wait, so
     * only what stays fully on screen while the list is at rest counts.
     */
    public onVisibleRangeChanged = (startIndex: number, endIndex: number, readableEndIndex = endIndex): void => {
        // The first row may be the loading spinner, the second the first message.
        this.atTop = startIndex <= 1;
        this.lastRange = [startIndex, endIndex, readableEndIndex];
        // Still being placed, not read: the view does not report again once it is, so onAnchorReached does.
        if (this.snapshot.current.pendingAnchor !== null) return;
        const items = this.snapshot.current.items;
        const readable = new Map<string, MatrixEvent>();
        for (let i = Math.max(0, startIndex); i <= readableEndIndex && i < items.length; i++) {
            const row = items[i].kind === "event" ? this.rows.get(items[i].key) : undefined;
            if (row) readable.set(row.room.roomId, row.event);
        }
        this.readable = readable;
        if (this.readTimer !== null) window.clearTimeout(this.readTimer);
        this.readTimer = window.setTimeout(() => {
            this.readTimer = null;
            this.markRead();
        }, READ_DWELL_MS);
    };

    /** Moves each room's receipt to what was read in it, if that is further on than where it is. */
    private markRead(): void {
        if (this.isDisposed || this.readable.size === 0) return;
        // Nothing is read by someone who is not there: a message arriving at the end while they are away is on
        // screen and unread. Marked once they are back, as a chat does.
        if (!UserActivity.sharedInstance().userActiveRecently()) {
            if (this.awayTimer) return;
            const timer = new Timer(READ_DWELL_MS);
            this.awayTimer = timer;
            UserActivity.sharedInstance().timeWhileActiveRecently(timer);
            timer.finished().then(
                () => {
                    if (this.awayTimer !== timer) return;
                    this.awayTimer = null;
                    this.markRead();
                },
                () => {
                    if (this.awayTimer === timer) this.awayTimer = null;
                },
            );
            return;
        }
        const me = this.props.client.getSafeUserId();
        for (const [roomId, read] of this.readable) {
            const room = this.props.client.getRoom(roomId);
            if (!room) continue;
            const live = room.getLiveTimeline().getEvents();
            const readAt = live.indexOf(read);
            if (readAt < 0) continue;
            const target = receiptTarget(live, readAt);
            // Never back: the server takes any receipt as the room read up to it.
            const receiptAt = live.findIndex((ev) => ev.getId() === room.getEventReadUpTo(me, true));
            if (receiptAt >= live.indexOf(target)) continue;
            const type = SettingsStore.getValue("sendReadReceipts", roomId)
                ? ReceiptType.Read
                : ReceiptType.ReadPrivate;
            this.props.client.sendReadReceipt(target, type).catch((e) => {
                logger.warn(`Stream: could not mark ${roomId} read`, e);
            });
        }
    }

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

/**
 * The event a room's receipt goes to when it is read up to `live[readAt]`: that message, or, when it is the
 * room's last message, the room's newest event. What follows it is then only what the Stream does not show (a
 * bridge's status, joins), which can still count as unread on the server and would leave the room unread for
 * good; the room's own timeline does the same.
 */
function receiptTarget(live: MatrixEvent[], readAt: number): MatrixEvent {
    for (let i = readAt + 1; i < live.length; i++) if (isStreamMessage(live[i])) return live[readAt];
    for (let i = live.length - 1; i > readAt; i--) {
        const id = live[i].getId();
        if (id && !id.startsWith("~") && live[i].status === null) return live[i];
    }
    return live[readAt];
}

/** Below this a bump_stamp is a position in the server's stream, not a time: 2001-09-09 in milliseconds. */
const MIN_TIMESTAMP = 1_000_000_000_000;

/**
 * How recent a message the room's unloaded history could hold: its oldest loaded event, or the time of its last
 * message if that is earlier. Most bridged chats' latest events are changes to the room (a bridge re-syncing a
 * chat's details), not messages; counting those as the room's position held the list at today until every
 * one of 600 rooms had been paged once (MEO-44, on a real account). Our server sends the time of the room's
 * last message as `bump_stamp`; a stream position instead (other servers) is not a time and is not used.
 */
function hiddenUpTo(room: Room, events: MatrixEvent[]): number | undefined {
    if (!events.length) return undefined;
    const oldest = events[0].getTs();
    const bump = room.getBumpStamp();
    return bump !== undefined && bump >= MIN_TIMESTAMP && bump < oldest ? bump : oldest;
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
