/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import {
    TimelineWindow,
    Direction,
    RoomEvent,
    EventType,
    MatrixEventEvent,
    RelationType,
    NotificationCountType,
    ReceiptType,
    LOCAL_PAGINATION_PREFIX,
    type IRoomTimelineData,
    type MatrixClient,
    type EventTimelineSet,
    type MatrixEvent,
    type Room,
} from "matrix-js-sdk/src/matrix";
import { BaseViewModel } from "@element-hq/web-shared-components";
import { logger } from "matrix-js-sdk/src/logger";

import type {
    TimelineViewSnapshot,
    TimelineViewActions,
    TimelineItem,
    NavigationAnchor,
    ImmediateScroll,
} from "@element-hq/web-shared-components";
import { haveRendererForEvent, pickFactory } from "../../../events/EventTileFactory";
import shouldHideEvent from "../../../shouldHideEvent";
import SettingsStore from "../../../settings/SettingsStore";
import UserActivity from "../../../UserActivity";
import Timer from "../../../utils/Timer";
import { eventTriggersUnreadCount } from "../../../Unread";
import { clearRoomNotification } from "../../../utils/notifications";
import { pendingEventsToShow } from "../../../utils/room/pendingEvents";
import { hasThreadSummary } from "../../../utils/EventUtils";
import { getPerMessageProfile } from "../../../utils/bridge/perMessageProfile";
import { readSeenUnread, rememberSeenUnread } from "../../../utils/timeline/seenUnread";

const DEBUG_TIMELINE = false;

/** Emits a trace line only when {@link DEBUG_TIMELINE} is on. */
const debug = (message: string): void => {
    if (DEBUG_TIMELINE) logger.debug(message);
};

/**
 * How long a message has to stay on screen, with the list at rest, before it counts as read (ms):
 * a message scrolled past is not one that was read.
 */
const READ_RECEIPT_DEBOUNCE_MS = 200;

const PAGINATE_SIZE = 100;
const INITIAL_SIZE = 100;

/**
 * How many messages we try to gather before showing the timeline for the first time. Enough to
 * more than fill any realistic window, so the list is long enough to scroll straight away.
 *
 * This matters more than it looks. The view keeps the reader's place by adjusting the scroll
 * position to cancel out whatever was added or removed — but a list shorter than the window
 * cannot be scrolled, so there is no scroll position to adjust and that trick does nothing.
 * Rows are then placed by layout alone, and anything loading in around them shoves them about.
 *
 * It bites hardest when we are holding a particular message in the middle — opening a permalink.
 * It has to fill both above and below its target, and letting those batches arrive progressively
 * would shift the target around as each one lands, which is precisely the message the reader came
 * to see. Gathering them before we show anything costs a slightly slower first paint, and for a
 * permalink we take that trade deliberately.
 *
 * Anywhere else only older history is missing, and it goes above what is being read. There the
 * trade goes the other way: waiting for the server before drawing messages the client already
 * holds is what made opening a chat feel like loading it. So those are shown as soon as whatever
 * the browser's own store has is in, and the server's share follows once they are placed (see
 * {@link RoomTimelineViewModel.fillInitialWindow}). A list still shorter than the window when it
 * does suffers the milder version of the problem: today the rows are laid out from the top, so
 * older history arriving above pushes everything down.
 *
 * The intended fix for that second case (not built yet) is to lay the rows out from the bottom
 * instead whenever we are at the live end and there is still history above us. Older messages
 * then grow upwards into the empty space, and the newest message — the one being read — never
 * moves, however few messages are loaded. Note this only applies while more history exists:
 * once the start of the room is loaded there is nothing left to grow into, and laying out from
 * the top is the right thing to do, as the timeline does today.
 *
 * Once that lands, this constant only matters for the anchored loads.
 */
const MIN_INITIAL_EVENTS = 40;

/** How long to wait before asking again for a page of history that failed to come: doubling, up to the max. */
const PAGINATE_RETRY_MIN_MS = 2_000;
const PAGINATE_RETRY_MAX_MS = 60_000;

/**
 * How many more pages to fetch, beyond the initial fill, for a chat whose newest events are all ones the
 * timeline hides (a bridge's status updates, a burst of joins) before deciding it has nothing to show.
 */
const MAX_HIDDEN_PAGES = 10;

/**
 * The most messages we keep loaded at once. Loading more than this makes the SDK drop an
 * equivalent number from the far end, so memory stays bounded however long someone scrolls.
 *
 * We set this explicitly rather than take the SDK's default so we know the exact number, which
 * lets {@link RoomTimelineViewModel.makeRoomBeforeExtending} see a drop coming and do it as a
 * separate step instead of letting it happen in the middle of adding new messages.
 */
const WINDOW_LIMIT = 1000;

/**
 * Maximum time {@link RoomTimelineViewModel.waitForDecryption} blocks the
 * paginate chain on newly-fetched events. Decryption usually completes in
 * tens of milliseconds; this cap stops a slow/failed decryption from holding
 * the loading spinner indefinitely. Anything slower than this is not lost: it appears shortly
 * after it does decrypt, via {@link RoomTimelineViewModel.onEventDecrypted} — the reader does
 * not have to scroll or wait for another message to prompt it.
 */
const PAGINATE_DECRYPT_WAIT_MS = 500;

/**
 * Discriminated union describing the initial scroll target for {@link RoomTimelineViewModel.load}.
 *
 * - `live`      — scroll to the live end of the room.
 * - `permalink` — centre on `eventId` and highlight it.
 * - `restore`   — scroll to the saved `eventId` without highlighting.
 */
/** Whether an event ID is a local echo's (an unsent message), which only this client knows. */
export function isLocalEchoId(eventId: string): boolean {
    return eventId.startsWith("~");
}

type LoadTarget = { kind: "live" } | { kind: "permalink"; eventId: string } | { kind: "restore"; eventId: string };

export interface RoomTimelineViewModelOpts {
    client: MatrixClient;
    room: Room;
    /** Optional anchor for initial load (permalink, search result). Shown highlighted and centred. */
    initialEventId?: string;
}

/**
 * Works out what the room timeline should show, and keeps it up to date.
 *
 * The shared `TimelineView` draws a list and reports what the user can see; it knows nothing
 * about Matrix. This class is the other half: it owns all the Matrix detail and hands the view
 * a plain list of rows to render. Everything travels in one direction each way — we publish a
 * snapshot (the rows, plus flags like "are we at the newest message"), and the view calls back
 * to say what happened ("the top is showing", "the user is at the bottom").
 *
 * The messages themselves come from the SDK's `TimelineWindow`, a sliding window over the room's
 * history. It holds at most {@link WINDOW_LIMIT} messages: paginating past that drops an equal
 * number off the far end, so scrolling for a long time does not grow memory without limit.
 *
 * What this class has to get right:
 *
 *  - **Turning events into rows.** Not every event is shown (hidden or unrenderable types are
 *    skipped), and some rows are not events at all — date separators, the unread marker, and
 *    the loading spinners at either end. See `buildItems`.
 *  - **Loading more when asked.** The view reports reaching either end; we fetch more history
 *    in that direction, showing a spinner while it happens.
 *  - **Where to start.** Usually the newest message, but a permalink starts at a specific
 *    message, and returning to a room restores where the reader left off. See `LoadTarget`.
 *  - **Read state.** Tracking the unread marker, deciding whether to offer a jump to it, and
 *    sending read receipts as the reader catches up.
 *
 * A note on timing: the constructor deliberately does nothing but set fields. React's StrictMode
 * builds two instances in development and discards one, so anything that subscribes or fetches
 * belongs in {@link start}, which the view calls exactly once.
 */
export class RoomTimelineViewModel
    extends BaseViewModel<TimelineViewSnapshot, RoomTimelineViewModelOpts>
    implements TimelineViewActions
{
    private readonly opts: RoomTimelineViewModelOpts;
    private timelineWindow: TimelineWindow;

    /**
     * Cache of continuation decisions keyed by event id.
     *
     * Whether a message is a "continuation" — drawn without repeating the sender's avatar and
     * name — depends on the message immediately before it. That is a problem when older history
     * loads in: the message that used to be first suddenly has something before it, and can flip
     * to being a continuation. Losing its avatar and name makes the row shorter, which drags
     * everything below it upwards and moves the text the reader was looking at.
     *
     * So we decide each message's continuation status the first time we see it and never revisit
     * it. The cost is an occasional repeated avatar where two loaded batches meet, which is far
     * less annoying than the text moving while you read it.
     */
    private continuationCache = new Map<string, boolean>();

    /** Set by {@link start} so a double-start (e.g. via StrictMode) is a no-op. */
    private started = false;
    /** Whether a load has finished, so that a list still empty means the chat has nothing to show. */
    private loaded = false;
    /** Counts loads, so that one finishing after a later one has begun drops its result. */
    private loadSeq = 0;

    /**
     * Set when the timeline was shown with fewer messages than {@link MIN_INITIAL_EVENTS} because
     * the rest are on the server. They are fetched once the view has placed what it was given
     * ({@link onAnchorReached}): rows arriving above while it is still scrolling to its starting
     * message would move that message from under it.
     */
    private fillAfterPlacing = false;

    /** Whether the fetch in flight is that one (see {@link fillAfterPlacing}). */
    private initialFillInFlight = false;

    /**
     * In-flight backward pagination chain, or null when idle.
     *
     * A single `Promise<void>` is created for the first `onStartReached` call.
     * Any further `onStartReached` calls while the chain is running set
     * {@link backwardRerunRequested} instead of starting a parallel chain.
     * When the chain settles this is set back to null (running one follow-up
     * chain if a request arrived meanwhile), and the next `onStartReached`
     * creates a fresh chain.
     *
     * Using a stored promise as the guard ensures coalescing survives the async
     * gap between when the chain finishes and when the next `onStartReached` fires.
     */
    private backwardPaginateChain: Promise<void> | null = null;

    /** Mirror of {@link backwardPaginateChain} for the forward direction. */
    private forwardPaginateChain: Promise<void> | null = null;

    /**
     * Set when the view asks for more history while a fetch is already running, and
     * acted on by running one more fetch once that one finishes.
     *
     * Coalescing must not *lose* the request: the view de-duplicates edge reports, and its
     * dedup key can collide across a chain boundary (observed: the spinner row's removal
     * exactly cancelling out one new event, leaving the same item count at the same scroll
     * index). When that happens the view never re-fires, and without this flag the timeline
     * sits stalled at the edge with more history available until the user jiggles the scroll.
     */
    private backwardRerunRequested = false;

    /** Mirror of {@link backwardRerunRequested} for the forward direction. */
    private forwardRerunRequested = false;

    /**
     * The real timeline content: messages, date separators and the unread marker, with no
     * loading spinners. {@link republish} adds the spinners on the way out to the view, so
     * showing or hiding one never has to touch this list.
     */
    private baseItems: TimelineItem[] = [];

    /**
     * Scroll-time unread lookup. The timeline and item rows only change when the room
     * publishes new data, while visible-range updates happen for every scroll frame.
     * Keep the expensive event lookups and unread classification on the data path.
     */
    private unreadIndex: {
        items: TimelineItem[];
        events: MatrixEvent[];
        eventCount: number;
        markerId: string | null;
        positions: Map<string, number>;
        eventRows: Array<{ itemIndex: number; timelineIndex: number }>;
        prefix: number[];
        positionedPrefix: number[];
        markerIndex: number;
    } | null = null;

    /** Whether the leading (backward) pagination spinner is currently shown. */
    private backwardSpinnerVisible = false;

    /** Whether the trailing (forward) pagination spinner is currently shown. */
    private forwardSpinnerVisible = false;

    /** The event ID for which we last sent a read receipt, to avoid redundant sends. */
    private lastSentReceiptEventId: string | null = null;

    /** Debounce timer for auto read receipt sends triggered by scroll. */
    private readReceiptDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    /**
     * The last event the reader can have read to its end: its bottom edge is on screen (see
     * `readableEndIndex` on {@link onVisibleRangeChanged}). This, not the last event with a line
     * showing, is what a read receipt is sent for.
     */
    private readableEventId: string | null = null;

    /** Waits for the reader to be back before a receipt is sent (see {@link sendAutoReadReceipt}). */
    private presenceTimer: Timer | null = null;

    /**
     * Debouncer for items rebuilds after a burst of Decrypted events.
     * See {@link onEventDecrypted} / {@link flushDecryptRebuild}.
     */
    private decryptDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    private static readonly DECRYPT_FLUSH_DEBOUNCE_MS = 200;

    /** True when the view reports the list is scrolled to the bottom. */
    private isAtBottom = false;
    /**
     * Whether the reader has scrolled up from the newest messages, as last seen while the room was on
     * screen. Not the opposite of isAtBottom: a room behind another one, or one built before it was
     * ever shown, is not "at the bottom" of anything and is not being read further back either.
     */
    private readingHistory = false;
    /**
     * Set when the room's live timeline was replaced while the reader was further back, and the window
     * was left on the old one (see onTimelineReset). The old timeline has no newer end to page towards,
     * so by itself the window would say it is at the live end; it is not, until it is loaded again.
     */
    private leftOnOldTimeline = false;

    /** Whether the window reaches the room's newest messages. */
    private windowAtLiveEnd(): boolean {
        return !this.leftOnOldTimeline && !this.timelineWindow.canPaginate(Direction.Forward);
    }

    /**
     * The event ID of the bottommost visible item as last reported by
     * {@link onVisibleRangeChanged}. Persisted to localStorage on dispose
     * so the view can be restored to this position next visit.
     */
    private lastBottomEventId: string | null = null;

    /**
     * The 0-based index (into the items array) of the topmost currently-visible item.
     * Updated on every `onVisibleRangeChanged` call; used to derive `canJumpToReadMarker`.
     */
    private visibleStartArrayIndex = 0;

    /**
     * The 0-based index (into the items array) of the bottommost currently-visible item.
     * Updated on every `onVisibleRangeChanged` call; used to derive `canJumpToReadMarker`.
     */
    private visibleEndArrayIndex = 0;

    /**
     * The Matrix event ID of the room's "fully read" marker. null when none is set.
     * Tracked via `RoomEvent.AccountData` / `EventType.FullyRead`. Reflects server
     * state and may change mid-session if another device advances the marker;
     * used by {@link dispose} and {@link onMarkAllAsRead} but NOT by the UI.
     */
    private readMarkerEventId: string | null = null;
    /** The last row read on screen (`readableEndIndex` of {@link onVisibleRangeChanged}), as an array index. */
    private readableEndArrayIndex = 0;
    /**
     * After a page of history failed to come, when it may be asked for again, per direction, and whether
     * the view asked meanwhile. Without this the view, still at the top, asked again the moment the
     * failure was published: offline that was a request every few milliseconds, 341 in 90 seconds.
     */
    private readonly paginateHold = new Map<Direction, { until: number; backoffMs: number; wanted: boolean }>();
    private paginateRetryTimers = new Map<Direction, ReturnType<typeof setTimeout>>();
    private onlineListener?: () => void;

    /** The newest message read on screen this session: what is at or before it is not unread. */
    private seenUpToId: string | null = null;

    /**
     * Where the unread line sits, decided once when the room is opened and then left alone for
     * as long as the reader stays in it. Set by {@link freezeReadMarkerForSession}, and read by
     * {@link buildItems}, {@link computeCanJumpToReadMarker} and {@link onJumpToReadMarker}.
     *
     * `null` means no line at all this visit — either the room was already read on entry, or
     * there is no marker. Otherwise the line stays pinned to that message however much the
     * reader scrolls, sends, or receives.
     *
     * Holding it still is deliberate, and matches Element X: a line that crept downwards
     * as you read would take away the very thing you are using it for — seeing where you got to.
     * It moves when the room is left and re-entered (see the `setRoomReadMarkers` call in
     * {@link dispose}), or immediately if the reader marks everything read
     * ({@link onMarkAllAsRead}).
     */
    private frozenMarkerEventId: string | null = null;

    /**
     * Messages that mention the reader and have not been seen, by event ID, with the time they were
     * sent: Telegram's "@" button. Filled once when the room is first loaded (from what was sent after
     * the reader's read position) and by the messages arriving after that; emptied as the reader
     * brings them on screen, or taps through them ({@link onJumpToUnreadMention}).
     */
    private unreadMentions = new Map<string, number>();

    /**
     * The reader's own messages somebody else has reacted to since the reader last read, and which
     * they have not seen since: Telegram's heart button. Keyed by the message reacted to, with the
     * reaction events behind it (so redacting the last one takes the message off again) and the time
     * the message was sent (they are visited oldest first).
     */
    private unreadReactions = new Map<string, { ts: number; reactions: Set<string> }>();

    /** Whether {@link scanUnread} has run: what was unread on entry is looked for once, not per load. */
    private scannedUnread = false;
    /** Mentions and reactions seen in this room in this or an earlier session (utils/timeline/seenUnread). */
    private seenUnread?: Set<string>;
    /** Messages a reaction was to that are not in memory, being fetched to see whether they are the reader's. */
    private readonly checkingTargets = new Set<string>();

    /**
     * Events that could not be sorted into either of the above because they are encrypted and have
     * not decrypted yet. Looked at again when they do ({@link onEventDecrypted}).
     */
    private undecryptedUnread = new Set<string>();

    private static readonly SCROLL_STATE_KEY_PREFIX = "timeline_scroll_";

    private static readScrollTarget(roomId: string): string | null {
        try {
            return localStorage.getItem(`${RoomTimelineViewModel.SCROLL_STATE_KEY_PREFIX}${roomId}`);
        } catch {
            return null;
        }
    }

    /**
     * The server's ID for an event: a link to an unsent message carries its local echo ID, which is swapped
     * for the real one once the message is sent. Undefined while it isn't sent, as the server can't find it.
     */
    private sentEventId(eventId: string): string | undefined {
        if (!isLocalEchoId(eventId)) return eventId;
        const room = this.opts.room;
        const event = room.findEventById(eventId) ?? room.getPendingEvents().find((e) => e.getId() === eventId);
        const id = event?.getId();
        return id && !isLocalEchoId(id) ? id : undefined;
    }

    private static saveScrollTarget(roomId: string, eventId: string | null): void {
        try {
            if (eventId) {
                localStorage.setItem(`${RoomTimelineViewModel.SCROLL_STATE_KEY_PREFIX}${roomId}`, eventId);
            } else {
                localStorage.removeItem(`${RoomTimelineViewModel.SCROLL_STATE_KEY_PREFIX}${roomId}`);
            }
        } catch {
            // Ignore storage errors (private browsing, quota exceeded, etc.)
        }
    }

    public constructor(opts: RoomTimelineViewModelOpts) {
        super(opts, {
            items: [],
            atLiveEnd: false,
            pendingAnchor: null,
            highlightedEventId: opts.initialEventId ?? null,
            isAtBottom: false,
            canJumpToReadMarker: false,
            numUnreadMessages: 0,
            hasHighlights: false,
            unreadMentions: 0,
            unreadReactions: 0,
        });

        this.opts = opts;
        this.timelineWindow = new TimelineWindow(opts.client, opts.room.getUnfilteredTimelineSet(), {
            windowLimit: WINDOW_LIMIT,
        });

        // Initialise the read marker from room account data.
        this.readMarkerEventId =
            (opts.room.getAccountData(EventType.FullyRead)?.getContent()?.event_id as string | undefined) ?? null;

        // NOTE: deliberately side-effect-free. React StrictMode (and useState
        // initializer checks) invoke `vmCreator` twice in dev, constructing
        // two instances; one is retained, one is discarded. If we registered
        // listeners or kicked off load() here, the discarded instance would
        // silently leak its subscriptions. Side effects belong in {@link start}
        // which the View calls exactly once via useEffect.
    }

    /**
     * Wire the VM up to its data sources and kick off the initial load.
     *
     * Must be called exactly once per instance, after construction, from a
     * React effect (so React's lifecycle controls when subscriptions attach).
     * Calling this from the constructor risks leaking listeners on
     * StrictMode-discarded instances; see the constructor comment.
     */
    public start(): void {
        // In StrictMode dev, a consumer's useEffect can briefly fire with a
        // stale `vm` reference between the hook disposing the old VM and
        // React re-rendering with the new one. That's harmless — we just bail.
        if (this.started || this.isDisposed) return;
        this.started = true;

        // Determine how to load the timeline.
        let loadTarget: LoadTarget;
        const permalinkTarget = this.opts.initialEventId && this.sentEventId(this.opts.initialEventId);
        if (permalinkTarget) {
            loadTarget = { kind: "permalink", eventId: permalinkTarget };
        } else {
            const savedEventId = RoomTimelineViewModel.readScrollTarget(this.opts.room.roomId);
            // A position saved before unsent messages were skipped may be a local echo ID.
            loadTarget =
                savedEventId && !isLocalEchoId(savedEventId)
                    ? { kind: "restore", eventId: savedEventId }
                    : { kind: "live" };
        }

        void this.load(loadTarget);

        // Listen for new events so live messages appear.
        this.disposables.trackListener(
            this.opts.room,
            RoomEvent.Timeline,
            this.onRoomTimeline as (...args: unknown[]) => void,
        );
        // Track changes to the room's fully-read marker.
        this.disposables.trackListener(
            this.opts.room,
            RoomEvent.AccountData,
            this.onRoomAccountData as (...args: unknown[]) => void,
        );
        // Decryption arrivals (late key delivery / key backup) need a rebuild
        // so previously-pending events that we filtered out of items become
        // visible. RoomEvent.Timeline only fires once per event at arrival
        // time and is not re-emitted on decryption (see js-sdk
        // event-timeline-set.js addEventToTimeline → emit Timeline), so this
        // listener is the only signal we have for that transition.
        this.disposables.trackListener(
            this.opts.client,
            MatrixEventEvent.Decrypted,
            this.onEventDecrypted as (...args: unknown[]) => void,
        );
        // A mention or a reaction that is taken back is no longer something to jump to.
        this.disposables.trackListener(
            this.opts.room,
            RoomEvent.Redaction,
            this.onRoomRedaction as (...args: unknown[]) => void,
        );
        // Sending, failing and being replaced by the remote echo all arrive here rather than
        // through RoomEvent.Timeline, which never sees a pending event.
        this.disposables.trackListener(this.opts.room, RoomEvent.LocalEchoUpdated, this.onLocalEchoUpdated);
        // The room's live timeline can be replaced under an open room (see onTimelineReset).
        this.disposables.trackListener(
            this.opts.room,
            RoomEvent.TimelineReset,
            this.onTimelineReset as (...args: unknown[]) => void,
        );
    }

    /**
     * The room's live timeline was replaced: a sync came back with a gap in it, so the SDK dropped the
     * timeline it had and started a new one from the events that came with the gap.
     *
     * The window is a view onto a timeline, and it went on being a view onto the one that was dropped:
     * everything arriving afterwards went into the new one, and none of it was drawn - the room showed
     * its last message from before the gap however many came after, with the room list beside it
     * counting them. Leaving the room and coming back used to cure it, because that rebuilt the room;
     * a room kept mounted for switching back to is not rebuilt, so it has to follow the timeline itself.
     *
     * Following live, the window moves to the new timeline's end, which is where the reader is. Reading
     * further back, they are left where they are - what is on screen is still what they were reading -
     * and the window is marked as no longer at the live end, so that going to the newest messages
     * loads them rather than scrolling to the end of what is here.
     */
    private onTimelineReset = (_room: Room | undefined, timelineSet: EventTimelineSet | undefined): void => {
        if (this.isDisposed) return;
        if (timelineSet !== this.opts.room.getUnfilteredTimelineSet()) return;
        debug(`[TimelineVM] live timeline reset — readingHistory=${this.readingHistory}`);
        if (this.readingHistory) {
            this.leftOnOldTimeline = true;
            this.mergeSnapshot({ atLiveEnd: false }, "timeline-reset");
        } else {
            void this.load({ kind: "live" });
        }
    };

    /**
     * A message of ours was queued, sent, failed or replaced by its remote echo. None of that
     * reaches RoomEvent.Timeline while the event is still pending, so this is the only signal
     * that the live end has changed. It shares the decryption path's rebuild, which already
     * knows to wait for an in-flight pagination and to keep the reader's position by message id.
     */
    private onLocalEchoUpdated = (): void => {
        if (this.isDisposed) return;
        this.flushDecryptRebuild();
    };

    private onRoomTimeline = (
        event: MatrixEvent,
        _room: Room | undefined,
        toStartOfTimeline: boolean | undefined,
        removed: boolean,
        data: IRoomTimelineData,
    ): void => {
        // Only events from the room's main timeline. Threads and filtered timelines have their
        // own timeline sets and are not our concern.
        const ourTimelineSet = this.opts.room.getUnfilteredTimelineSet();
        if (data.timeline.getTimelineSet() !== ourTimelineSet) return;

        // Only genuinely new messages arriving at the end of the timeline. Older messages we
        // fetched ourselves come back through this same event, as do removals, and without this
        // check we would rebuild the whole list every time a reaction or redaction went past.
        if (toStartOfTimeline || removed || data.liveEvent !== true) return;
        if (this.isDisposed) return;

        debug(`[TimelineVM][onRoomTimeline] live event ${event.getId()} (${event.getType()})`);
        // Before the paginate below: reactions never get a row, so they do not need it, and the
        // buttons should not wait for the list.
        this.noteUnreadCandidate(event, true);
        this.publishUnreadCounts();
        // Extend the window by one so the new message is inside it, then rebuild.
        void this.timelineWindow
            .paginate(Direction.Forward, 1, false)
            .then(() => {
                if (this.isDisposed) return;
                const items = this.buildItems();

                const atLiveEnd = this.windowAtLiveEnd();
                this.baseItems = items;
                this.republish("live-event", {
                    atLiveEnd,
                    numUnreadMessages: this.isAtBottom && atLiveEnd ? 0 : this.unreadBelow(items, atLiveEnd),
                    hasHighlights: this.opts.room.getUnreadNotificationCount(NotificationCountType.Highlight) > 0,
                    canJumpToReadMarker: this.computeCanJumpToReadMarker(items),
                });
                // Read where it arrived, even if it is not drawn (receiptTarget).
                if ((this.isAtBottom || this.snapshot.current.isEmpty) && atLiveEnd) this.scheduleReceipt();
            })
            .catch((err) => {
                logger.warn(`[TimelineVM][onRoomTimeline] forward paginate failed`, err);
            });
    };

    /**
     * A message in our window has decrypted. Rebuild the list so anything we were holding back
     * while it decrypted ({@link shouldIncludeEvent}) now gets a row.
     *
     * This is what guarantees a slow decryption still shows up. Everywhere else that skips an
     * undecrypted message relies on this: the reader never has to scroll, or wait for someone to
     * send something, to see it.
     *
     * Debounced so that a burst of decryptions — which is what a paginate usually triggers —
     * causes one rebuild rather than one per message. Rebuilding per message remounted the rows
     * repeatedly and restarted any media they were downloading.
     */
    private onEventDecrypted = (event: MatrixEvent): void => {
        if (this.isDisposed) return;
        // A mention or a reaction that could not be read when it arrived.
        const id = event.getId();
        if (id && this.undecryptedUnread.delete(id)) {
            this.noteUnreadCandidate(event, true);
            this.publishUnreadCounts();
        }
        if (!this.timelineWindow.getEvents().includes(event)) return;

        if (this.decryptDebounceTimer !== null) clearTimeout(this.decryptDebounceTimer);
        this.decryptDebounceTimer = setTimeout(() => {
            this.decryptDebounceTimer = null;
            this.flushDecryptRebuild();
        }, RoomTimelineViewModel.DECRYPT_FLUSH_DEBOUNCE_MS);
    };

    /**
     * Rebuild items in response to a settled burst of decryptions, routing the swap
     * through {@link commitItems} (which updates {@link baseItems} and counts newly-shown
     * events; the virtualizer holds scroll position by key, so no index bookkeeping).
     *
     * **Gated against in-flight paginate chains.** If a chain is running, we
     * defer: the chain's terminal {@link buildItems} will pick up everything
     * these decrypts revealed, and a concurrent rebuild here would race the
     * chain's own {@link commitItems} call. We re-arm the debounce timer so we
     * try again after the chain finishes — that way a decrypt that fires deep
     * inside a chain doesn't get lost if no further decrypts arrive.
     */
    private flushDecryptRebuild(): void {
        if (this.isDisposed) return;

        if (this.backwardPaginateChain !== null || this.forwardPaginateChain !== null) {
            // Defer until the chain ends.
            if (this.decryptDebounceTimer === null) {
                this.decryptDebounceTimer = setTimeout(() => {
                    this.decryptDebounceTimer = null;
                    this.flushDecryptRebuild();
                }, RoomTimelineViewModel.DECRYPT_FLUSH_DEBOUNCE_MS);
            }
            return;
        }

        const itemsNew = this.buildItems();
        const prevLength = this.baseItems.length;

        const newCanJumpToReadMarker = this.computeCanJumpToReadMarker(itemsNew);
        const newHasHighlights = this.opts.room.getUnreadNotificationCount(NotificationCountType.Highlight) > 0;

        // Swap in the rebuilt list. Where decryption has revealed a message we were holding back,
        // it slots into place and the view keeps the reader's position by message id.
        const newlyShown = this.commitItems(itemsNew);
        const changed = newlyShown > 0 || itemsNew.length !== prevLength;

        if (!changed) {
            // No rows gained or lost — everything that decrypted turned out to be something we
            // do not show anyway, like a reaction or an edit. Just refresh the derived flags;
            // mergeSnapshot skips the update entirely if none of them actually moved.
            this.mergeSnapshot(
                { canJumpToReadMarker: newCanJumpToReadMarker, hasHighlights: newHasHighlights },
                "decrypt-flush(no-op)",
            );
            return;
        }

        // Items grew (typical: historical encrypted events newly decrypted).
        this.republish(`decrypt-flush(+${newlyShown})`, {
            canJumpToReadMarker: newCanJumpToReadMarker,
            hasHighlights: newHasHighlights,
        });
    }

    /**
     * Wait up to `timeoutMs` for the given encrypted-pending events to decrypt.
     *
     * Resolves as soon as all the given events have either decrypted (success or failure) or the
     * timeout fires, whichever comes first. Waiting here is only an optimisation: anything still
     * undecrypted when we give up is added by {@link onEventDecrypted} once it lands.
     */
    private async waitForDecryption(events: MatrixEvent[], timeoutMs: number): Promise<void> {
        const pending = events.filter(
            (e) => e.isEncrypted() && e.getClearContent() === null && !e.isDecryptionFailure(),
        );
        if (pending.length === 0) return;

        const detachers: Array<() => void> = [];
        const allDecrypted = Promise.all(
            pending.map(
                (e) =>
                    new Promise<void>((resolve) => {
                        if (e.getClearContent() !== null || e.isDecryptionFailure()) {
                            resolve();
                            return;
                        }
                        const handler = (): void => {
                            e.off(MatrixEventEvent.Decrypted, handler);
                            resolve();
                        };
                        e.on(MatrixEventEvent.Decrypted, handler);
                        detachers.push(() => e.off(MatrixEventEvent.Decrypted, handler));
                    }),
            ),
        );

        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<void>((resolve) => {
            timeoutId = setTimeout(resolve, timeoutMs);
        });

        try {
            await Promise.race([allDecrypted, timeout]);
        } finally {
            if (timeoutId !== undefined) clearTimeout(timeoutId);
            for (const detach of detachers) detach();
        }
    }

    private onRoomAccountData = (ev: MatrixEvent): void => {
        if (ev.getType() !== EventType.FullyRead) return;
        const newMarker = (ev.getContent()?.event_id as string | undefined) ?? null;
        if (newMarker === this.readMarkerEventId) return;
        // Track the server-side marker so dispose() can avoid redundant writes,
        // but don't touch frozenMarkerEventId — the visible divider position is
        // pinned for the session. If the user wants the marker line to reflect
        // changes another device made mid-session they can leave and re-enter.
        this.readMarkerEventId = newMarker;
    };

    /**
     * Snapshot the current read-marker position into {@link frozenMarkerEventId}.
     * Called once per session by {@link load} after the initial window is loaded.
     *
     * The frozen value is what the UI consumes for the entire session:
     *  - `null` when the marker is unset OR on the room's latest known event.
     *    In that case the divider line is never rendered this session even if
     *    new events arrive later (matches the iOS "nothing new since last
     *    visit → no line" behaviour).
     *  - Otherwise the marker's event id, pinned at that position for the
     *    session regardless of subsequent sends, scrolls, or new events.
     */
    private freezeReadMarkerForSession(): void {
        if (!this.readMarkerEventId) {
            this.frozenMarkerEventId = null;
            return;
        }
        // Fully read on entry — no line, ever, this session.
        this.frozenMarkerEventId = this.hasUnseenAfter(this.readMarkerEventId) ? this.readMarkerEventId : null;
        debug(`[TimelineVM] freezeReadMarkerForSession — frozen=${this.frozenMarkerEventId}`);
    }

    /**
     * Whether a line belongs after an event: something the reader has not seen follows it - a message
     * from somebody else that gets a row, or will once it has decrypted - and more than that one.
     *
     * Not "any event at all", which is what this used to ask. Events that are never drawn follow almost
     * every message of ours in a bridged chat (the bridge reporting that it was sent, then delivered),
     * so the marker was never on the room's last event and the line was armed in a chat with nothing
     * unread in it. It stayed out of sight while nothing was drawn after it, and came up over the
     * reader's own next message. Their own messages are not news to them either.
     */
    private hasUnseenAfter(eventId: string): boolean {
        const liveEvents = this.opts.room.getLiveTimeline().getEvents();
        const at = liveEvents.findIndex((event) => event.getId() === eventId);
        // Further back than what is loaded: what follows it is not known here, so the line stands.
        if (at < 0) return true;
        const showHiddenEvents = SettingsStore.getValue("showHiddenEventsInTimeline");
        const me = this.opts.client.getUserId();
        const drawn = liveEvents.slice(at + 1).filter((event) => {
            const stillDecrypting =
                event.getWireType() === EventType.RoomMessageEncrypted &&
                !event.isDecryptionFailure() &&
                event.getClearContent() === null;
            return stillDecrypting || this.shouldIncludeEvent(event, showHiddenEvents);
        });
        const firstUnseen = drawn.findIndex((event) => event.getSender() !== me);
        /*
         * And not for one new message that is the chat's last: there the line says nothing the message
         * does not say by being last. Telegram Web's rule (tweb `setUnreadDelimiter` in
         * components/chat/bubbles.ts: the first unread bubble is marked unless it is the history's
         * newest message).
         */
        return firstUnseen >= 0 && firstUnseen < drawn.length - 1;
    }

    private async load(target: LoadTarget): Promise<void> {
        debug(
            `[TimelineVM] load() start — kind=${target.kind}${target.kind !== "live" ? ` eventId=${target.eventId}` : ""}`,
        );
        const sdkLoadTarget = target.kind !== "live" ? target.eventId : undefined;
        // A link opened while the first load is still running must not be undone when that load lands.
        const seq = ++this.loadSeq;
        const superseded = (): boolean => this.isDisposed || seq !== this.loadSeq;

        try {
            await this.bringInStoredRoom(sdkLoadTarget);
            if (superseded()) return;
            await this.timelineWindow.load(sdkLoadTarget, INITIAL_SIZE);
            if (superseded()) return;
            // Loaded afresh, the window is on whatever the room's timelines are now.
            this.leftOnOldTimeline = false;
            this.fillAfterPlacing = false;
            if (target.kind === "permalink") {
                // Gather enough messages on both sides of the target before we show anything.
                await this.fillInitialWindow(sdkLoadTarget, "server");
            } else {
                // What this browser has stored costs no round trip, so it is worth having before the
                // first paint; what only the server has is not, unless there is nothing to show at all.
                await this.fillInitialWindow(undefined, "stored");
                if (superseded()) return;
                await this.waitForDecryption(this.timelineWindow.getEvents(), PAGINATE_DECRYPT_WAIT_MS);
                if (superseded()) return;
                const renderable = this.renderableEventCount(undefined, Direction.Backward);
                if (renderable === 0) {
                    await this.fillInitialWindow(undefined, "server");
                    for (
                        let page = 0;
                        page < MAX_HIDDEN_PAGES &&
                        this.renderableEventCount(undefined, Direction.Backward) === 0 &&
                        this.timelineWindow.canPaginate(Direction.Backward);
                        page++
                    ) {
                        if (superseded()) return;
                        await this.timelineWindow.paginate(Direction.Backward, PAGINATE_SIZE, true);
                    }
                } else {
                    this.fillAfterPlacing =
                        renderable < MIN_INITIAL_EVENTS && this.timelineWindow.canPaginate(Direction.Backward);
                }
            }
            if (superseded()) return;
            const windowEvents = this.timelineWindow.getEvents();
            debug(
                `[TimelineVM] load() window — ${windowEvents.length} events in window, ` +
                    `canPaginate(Backward)=${this.timelineWindow.canPaginate(Direction.Backward)}, ` +
                    `canPaginate(Forward)=${this.timelineWindow.canPaginate(Direction.Forward)}`,
            );
            if (windowEvents.length > 0) {
                debug(
                    `[TimelineVM] load() window first=${windowEvents[0].getId()} (${windowEvents[0].getType()}), ` +
                        `last=${windowEvents[windowEvents.length - 1].getId()} (${windowEvents[windowEvents.length - 1].getType()})`,
                );
            }
            // Snapshot the read-marker for the duration of this session. Must run
            // BEFORE buildItems so it sees the frozen value.
            this.freezeReadMarkerForSession();
            this.scanUnread();
            const items = this.buildItems();
            debug(`[TimelineVM] load() done — ${windowEvents.length} events → ${items.length} items after filtering`);

            let pendingAnchor: NavigationAnchor | null = null;

            // Only anchor to a target that is actually in `items` — otherwise the
            // anchor could never settle in view. A permalink/restore target that was
            // filtered (state event, redaction, unrenderable type) falls through to
            // the live-end anchor below.
            if (target.kind === "permalink") {
                if (items.some((i) => i.key === target.eventId)) {
                    pendingAnchor = { targetKey: target.eventId, align: "center" };
                } else {
                    debug(
                        `[TimelineVM] load() — permalink target ${target.eventId} not in items, falling back to live end`,
                    );
                }
            } else if (target.kind === "restore") {
                if (items.some((i) => i.key === target.eventId)) {
                    pendingAnchor = { targetKey: target.eventId, align: "end" };
                } else {
                    // Saved event was filtered/redacted and can't be displayed.
                    // Clear the stale position so next visit doesn't loop back here.
                    debug(
                        `[TimelineVM] load() — restore target ${target.eventId} not in items, clearing saved position and falling back to live end`,
                    );
                    RoomTimelineViewModel.saveScrollTarget(this.opts.room.roomId, null);
                    // No anchor needed — fall through to live-end logic below.
                }
            }

            if (!pendingAnchor && items.length > 0 && this.windowAtLiveEnd()) {
                // Live-end: anchor to the last item so the view lands at the bottom.
                pendingAnchor = { targetKey: items[items.length - 1].key, align: "end" };
                debug(`[TimelineVM] load() — live-end anchor key=${pendingAnchor.targetKey}`);
            }

            this.baseItems = items;
            this.backwardSpinnerVisible = false;
            this.forwardSpinnerVisible = false;
            this.loaded = true;
            this.republish(`load(${target.kind})-done`, {
                atLiveEnd: this.windowAtLiveEnd(),
                pendingAnchor,
                highlightedEventId: target.kind === "permalink" ? target.eventId : null,
                canJumpToReadMarker: this.computeCanJumpToReadMarker(items),
                ...this.unreadCounts(),
            });
            // Opening a chat with nothing to show reads it (receiptTarget).
            if (this.snapshot.current.isEmpty) this.scheduleReceipt();

            // If all events in the initial window were filtered (items empty) but more
            // content exists ahead, the view won't fire onEndReached on an empty list.
            // Proactively forward-paginate to find visible events.
            if (items.length === 0 && this.timelineWindow.canPaginate(Direction.Forward)) {
                debug(`[TimelineVM] load() — items empty with more content ahead, auto-triggering forward paginate`);
                this.triggerForwardPaginate();
            }
        } catch (e) {
            logger.error(`[TimelineVM] load() error`, e);
            this.loaded = true;
            this.backwardSpinnerVisible = false;
            this.forwardSpinnerVisible = false;
            this.republish(`load(${target.kind})-error`);
        }
    }

    /**
     * After a restart a room is in memory only as far as the room list needs it: its last few
     * events and a handful of state. The rest of what was synced is in the browser's store, and
     * this brings in the parts of it the timeline is about to use.
     *
     * The state comes first, and is waited for: an event takes its sender's name and avatar from
     * the room's state at the moment it is added to the timeline, so history read back before the
     * members were would be drawn under bare user IDs for good.
     *
     * Then, when the timeline is to open on a particular message (`eventId`) that is not in
     * memory, the stored history is read back before the server is asked for that message's
     * surroundings — it is most often there, a little above where the replay cut the room off, and
     * finding it locally saves the round trip the first paint would otherwise wait for.
     */
    private async bringInStoredRoom(eventId: string | undefined): Promise<void> {
        const { client, room } = this.opts;
        await client.loadStoredRoomState?.(room.roomId);
        if (!eventId || this.isDisposed) return;

        const timelineSet = room.getUnfilteredTimelineSet();
        const live = timelineSet.getLiveTimeline();
        if (
            !timelineSet.getTimelineForEvent(eventId) &&
            live.getPaginationToken(Direction.Backward)?.startsWith(LOCAL_PAGINATION_PREFIX)
        ) {
            await client.paginateEventTimeline(live, { backwards: true, limit: PAGINATE_SIZE });
        }
    }

    /**
     * Fetches extra messages so the first thing the reader sees is longer than the window and
     * can be scrolled — see {@link MIN_INITIAL_EVENTS} for why that matters. All of this happens
     * before anything is shown.
     *
     * Which way we fetch depends on where we are starting:
     *  - **Opening a permalink** (`centreOn` set): the message has to sit in the middle, so it
     *    needs messages on both sides — we aim for about half the target each way. Without the
     *    newer half it would be the last message in the list, and "centre" would put it at the
     *    bottom of the screen instead.
     *  - **Anywhere else**: we start at the newest message, so only older ones are needed.
     *
     * Usually this costs nothing: opening a permalink already fetches the messages around it,
     * and we only go to the server when there is genuinely nothing loaded on that side. Each
     * direction gets a couple of attempts at most, so a room that keeps returning events we
     * do not display cannot hold up the first paint — we show what we have, and the reader's
     * first scroll fetches more in the normal way.
     *
     * `from` says how far to go for them. "stored" stops where the next batch would have to come
     * from the server: after a restart a room has only its last few events in memory and the rest
     * of what was synced in the browser's store, which is a local read. "server" goes on to ask
     * the homeserver, and is only awaited before the first paint where nothing can be shown
     * without it (see {@link load}).
     */
    private async fillInitialWindow(centreOn: string | undefined, from: "stored" | "server"): Promise<void> {
        const MAX_FILL_REQUESTS_PER_DIRECTION = 2;
        const perDirectionTarget = centreOn ? Math.ceil(MIN_INITIAL_EVENTS / 2) : MIN_INITIAL_EVENTS;

        for (const direction of [Direction.Backward, Direction.Forward]) {
            // Unanchored loads only need history above the bottom-anchored view.
            if (!centreOn && direction === Direction.Forward) break;

            let requests = 0;
            while (
                requests < MAX_FILL_REQUESTS_PER_DIRECTION &&
                this.renderableEventCount(centreOn, direction) < perDirectionTarget &&
                this.timelineWindow.canPaginate(direction)
            ) {
                requests++;
                const before = this.timelineWindow.getEvents().length;
                // Without a request the window still takes in whatever the room already holds beyond it.
                const mayRequest = from === "server" || this.nextBatchIsStored(direction);
                const extended = await this.timelineWindow.paginate(direction, PAGINATE_SIZE, mayRequest);
                if (this.isDisposed) return;
                if (!mayRequest && !extended) break;
                debug(
                    `[TimelineVM] fillInitialWindow — paginate(${direction === Direction.Backward ? "backward" : "forward"}) ` +
                        `window: ${before}→${this.timelineWindow.getEvents().length}, ` +
                        `renderable(side)=${this.renderableEventCount(centreOn, direction)}`,
                );
            }
        }
    }

    /**
     * Whether paginating the window this way is answered from the browser's store rather than by
     * the server: the window's edge is the start of a trimmed replay (see the SDK's
     * `savedSyncTrim`), whose pagination token names the stored events before it.
     */
    private nextBatchIsStored(direction: Direction): boolean {
        const edge = this.timelineWindow.getTimelineIndex(direction)?.timeline;
        return !!edge?.getPaginationToken(direction)?.startsWith(LOCAL_PAGINATION_PREFIX);
    }

    /**
     * Count renderable events in the window. With `centreOn` set, counts only
     * those strictly on `direction`'s side of that event (so each side of a
     * centred target can be filled independently); without it, counts the whole
     * window. Side-effect-free — does not touch the continuation cache.
     */
    private renderableEventCount(centreOn: string | undefined, direction: Direction): number {
        const events = this.timelineWindow.getEvents();
        const showHiddenEvents = SettingsStore.getValue("showHiddenEventsInTimeline");

        let from = 0;
        let to = events.length;
        if (centreOn) {
            const idx = events.findIndex((e) => e.getId() === centreOn);
            if (idx !== -1) {
                if (direction === Direction.Backward) to = idx;
                else from = idx + 1;
            }
        }

        let count = 0;
        for (let i = from; i < to; i++) {
            if (this.shouldIncludeEvent(events[i], showHiddenEvents)) count++;
        }
        return count;
    }

    // ── TimelineViewActions ──────────────────────────────────────────

    public onStartReached = (): void => {
        debug(`[TimelineVM] onStartReached — items=${this.snapshot.current.items.length}`);
        this.triggerBackwardPaginate();
    };

    public onEndReached = (): void => {
        debug("[TimelineVM] onEndReached");
        this.triggerForwardPaginate();
    };

    /**
     * The View reports the anchor placement has settled. We clear `pendingAnchor`,
     * re-enabling `followOutput` and resuming scroll-position / read-receipt tracking.
     * Held until now so the cold-loading list stays pinned to the anchor instead of
     * being snapped to the bottom by the virtualizer's grow-to-bottom trap (see the View's onSettled).
     */
    public onAnchorReached = (): void => {
        if (this.snapshot.current.pendingAnchor === null) return;
        debug(`[TimelineVM] onAnchorReached — placement settled, clearing pendingAnchor`);
        this.mergeSnapshot({ pendingAnchor: null }, "anchor-settled");
        if (this.fillAfterPlacing) {
            // The history the first paint did not wait for. From here it is an ordinary fetch of
            // older messages: they land above the reader, who is held in place by the view.
            this.fillAfterPlacing = false;
            const idle = this.backwardPaginateChain === null;
            this.triggerBackwardPaginate();
            this.initialFillInFlight = idle && this.backwardPaginateChain !== null;
        }
    };

    /**
     * How many unread messages are below what the reader has read on screen, as Telegram's "down" button
     * counts them: from others, of the kinds that count as unread, after the read marker and after the last
     * row read on screen. Past the end of what is loaded, the server's count for the room stands in.
     */
    private unreadBelow(items: TimelineItem[], atLiveEnd: boolean): number {
        const room = this.opts.room;
        const client = this.opts.client;
        const me = client.getSafeUserId();
        const events = room.getLiveTimeline().getEvents();
        let index = this.unreadIndex;
        if (
            index?.items !== items ||
            index.events !== events ||
            index.eventCount !== events.length ||
            index.markerId !== this.readMarkerEventId
        ) {
            const positions = new Map<string, number>();
            for (let i = 0; i < events.length; i++) {
                const id = events[i].getId();
                if (id) positions.set(id, i);
            }

            const prefix = new Array<number>(items.length + 1).fill(0);
            const positionedPrefix = new Array<number>(items.length + 1).fill(0);
            const eventRows: Array<{ itemIndex: number; timelineIndex: number }> = [];
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                let eligible = false;
                let positionedEligible = false;
                if (item.kind === "event" && !isLocalEchoId(item.key)) {
                    const timelineIndex = positions.get(item.key);
                    // Preserve events found in a linked timeline segment. They have no
                    // live-timeline position, so the old read-through rule counted them
                    // only when there was no receipt/seen position to compare against.
                    const event = timelineIndex === undefined ? room.findEventById(item.key) : events[timelineIndex];
                    if (event) {
                        eligible = event.getSender() !== me && eventTriggersUnreadCount(client, event);
                        if (timelineIndex !== undefined) {
                            eventRows.push({ itemIndex: i, timelineIndex });
                            positionedEligible = eligible;
                        }
                    }
                }
                prefix[i + 1] = prefix[i] + Number(eligible);
                positionedPrefix[i + 1] = positionedPrefix[i] + Number(positionedEligible);
            }

            index = {
                items,
                events,
                eventCount: events.length,
                markerId: this.readMarkerEventId,
                positions,
                eventRows,
                prefix,
                positionedPrefix,
                markerIndex: this.readMarkerEventId
                    ? items.findIndex((item) => item.key === this.readMarkerEventId)
                    : -1,
            };
            this.unreadIndex = index;
        }

        const seenAt = this.seenUpToId ? (index.positions.get(this.seenUpToId) ?? -1) : -1;
        // And what the reader's receipt already covers: opened partway up a room with one unread message,
        // the button counted every message below the screen, 41 of them.
        const readUpTo = room.getEventReadUpTo(me, true);
        const receiptAt = readUpTo ? (index.positions.get(readUpTo) ?? -1) : -1;
        const timelineReadThrough = Math.max(seenAt, receiptAt);

        // Rows and live timeline events share chronological order. Translate the receipt
        // position to the last represented row, then answer with a prefix subtraction.
        let low = 0;
        let high = index.eventRows.length;
        while (low < high) {
            const mid = (low + high) >>> 1;
            if (index.eventRows[mid].timelineIndex <= timelineReadThrough) low = mid + 1;
            else high = mid;
        }
        const receiptItemIndex = low > 0 ? index.eventRows[low - 1].itemIndex : -1;
        const through = Math.max(this.readableEndArrayIndex, index.markerIndex, receiptItemIndex);
        const prefix = timelineReadThrough >= 0 ? index.positionedPrefix : index.prefix;
        let count = prefix[items.length] - prefix[Math.min(items.length, through + 1)];
        if (!atLiveEnd) count = Math.max(count, room.getUnreadNotificationCount(NotificationCountType.Total));
        return count;
    }

    public onAtBottomStateChange = (atBottom: boolean): void => {
        this.isAtBottom = atBottom;
        if (atBottom) this.scheduleReceipt();
        if (this.active) this.readingHistory = !atBottom;
        this.mergeSnapshot(
            {
                isAtBottom: atBottom,
                numUnreadMessages:
                    atBottom && this.snapshot.current.atLiveEnd
                        ? 0
                        : this.unreadBelow(this.snapshot.current.items, this.snapshot.current.atLiveEnd),
            },
            "at-bottom",
        );
    };

    /**
     * Called by the View on every visible-range change.
     * Walks backwards from `endIndex` to find the bottommost rendered event,
     * then stores its ID for scroll-position persistence on dispose.
     */
    public onVisibleRangeChanged = (startIndex: number, endIndex: number, readableEndIndex = endIndex): void => {
        // Don't record position while an anchor is pending — the range reflects
        // auto-placement, not the user's reading position. The View clears the
        // anchor (via onAnchorReached) once placement settles, after which normal
        // tracking resumes.
        if (this.snapshot.current.pendingAnchor !== null) return;

        const items = this.snapshot.current.items;

        // startIndex/endIndex are 0-based into `items` (the View reports array indices).
        const prevStartArrayIndex = this.visibleStartArrayIndex;
        const prevEndArrayIndex = this.visibleEndArrayIndex;
        this.visibleStartArrayIndex = Math.max(0, startIndex);
        this.visibleEndArrayIndex = Math.max(0, endIndex);
        this.readableEndArrayIndex = Math.max(0, readableEndIndex);

        for (let i = endIndex; i >= startIndex; i--) {
            const item = items[i];
            // An unsent message's key is its local echo ID ("~…"), which the server doesn't know: it can be
            // neither a read receipt nor the place to reopen the room at.
            if (item?.kind === "event" && !isLocalEchoId(item.key)) {
                this.lastBottomEventId = item.key;
                break;
            }
        }

        for (let i = readableEndIndex; i >= startIndex; i--) {
            const item = items[i];
            if (item?.kind === "event" && !isLocalEchoId(item.key)) {
                this.readableEventId = item.key;
                if (this.active && this.isAfter(item.key, this.seenUpToId)) this.seenUpToId = item.key;
                break;
            }
        }

        // What is on screen has been seen: the mentions and reactions in it are no longer news. Not by
        // a room behind another one, whose rows are laid out but not looked at.
        if (this.active) this.markSeen(items, startIndex, readableEndIndex);

        // Recompute canJumpToReadMarker when the visible range moves.
        if (this.visibleStartArrayIndex !== prevStartArrayIndex || this.visibleEndArrayIndex !== prevEndArrayIndex) {
            const canJumpToReadMarker = this.computeCanJumpToReadMarker(items);
            if (canJumpToReadMarker !== this.snapshot.current.canJumpToReadMarker) {
                this.mergeSnapshot({ canJumpToReadMarker }, "range-changed");
            }
        }

        // Telegram's count on the "down" button: the unread messages still below what is read on screen.
        const numUnreadMessages =
            this.isAtBottom && this.snapshot.current.atLiveEnd
                ? 0
                : this.unreadBelow(items, this.snapshot.current.atLiveEnd);
        if (numUnreadMessages !== this.snapshot.current.numUnreadMessages) {
            this.mergeSnapshot({ numUnreadMessages }, "unread-below");
        }

        this.scheduleReceipt();
    };

    /** Debounces sending a read receipt for what has been read (see {@link receiptTarget}). */
    private scheduleReceipt(): void {
        if (this.readReceiptDebounceTimer !== null) clearTimeout(this.readReceiptDebounceTimer);
        this.readReceiptDebounceTimer = setTimeout(() => {
            this.readReceiptDebounceTimer = null;
            this.sendAutoReadReceipt();
        }, READ_RECEIPT_DEBOUNCE_MS);
    }

    /**
     * Where the receipt goes: the last message read on screen - or, with the reader at the end of the room,
     * the room's newest event, drawn or not. Events the timeline hides (a bridge's status, joins, an invite)
     * can count as unread on the server, and with the receipt never going past the last message drawn they
     * stayed unread for good: a chat with nothing to show at all kept its unread count in the chat list.
     */
    private receiptTarget(): string | null {
        const atEnd = this.snapshot.current.atLiveEnd && (this.isAtBottom || !!this.snapshot.current.isEmpty);
        if (atEnd) {
            const events = this.opts.room.getLiveTimeline().getEvents();
            for (let i = events.length - 1; i >= 0; i--) {
                const id = events[i].getId();
                if (id && !isLocalEchoId(id) && events[i].status === null) return id;
            }
        }
        return this.readableEventId;
    }

    /**
     * Sends a read receipt for the last visible event, debounced from `onVisibleRangeChanged`.
     * Only advances the receipt — never rewinds it. Respects the `sendReadReceipts` setting.
     *
     * Read receipts (`m.read`) and the FullyRead marker (`m.fully_read`) serve different
     * purposes. Read receipts are public — they tell *other* users where this user has
     * read up to — and should advance freely as the user scrolls. The FullyRead marker is
     * private and drives the local "unread divider" line; advancing it mid-session causes
     * the divider to jump (e.g. landing above the user's own outgoing message). So we
     * only advance the receipt here. The FullyRead marker is advanced once on dispose
     * (see {@link dispose}), mirroring Element X iOS's behaviour.
     */
    private sendAutoReadReceipt(): void {
        // Behind the room on screen, nothing in it is being read.
        if (this.isDisposed || !this.active) return;
        const eventId = this.receiptTarget();
        if (!eventId || eventId === this.lastSentReceiptEventId) return;
        // Nor is anything read by someone who is not there: a message that arrives while the window
        // is in the background or the reader has walked away is on screen, and unread. It is sent
        // when they are back (the old timeline waits the same way).
        if (!UserActivity.sharedInstance().userActiveRecently()) {
            this.sendReceiptOnceBack();
            return;
        }

        const event =
            this.timelineWindow.getEvents().find((e) => e.getId() === eventId) ?? this.opts.room.findEventById(eventId);
        if (!event) return;

        // Nor behind where the reader's receipt already is, as after jumping up to a mention or a reaction:
        // the receipt would move back, and the server takes any receipt as reading the whole room and
        // clears its counts, so a room half read showed as read.
        if (this.receiptIsPast(eventId)) {
            this.lastSentReceiptEventId = eventId;
            return;
        }

        // Don't rewind — only advance if this event is newer than the last receipted one.
        if (this.lastSentReceiptEventId) {
            const lastSentEvent = this.timelineWindow
                .getEvents()
                .find((e) => e.getId() === this.lastSentReceiptEventId);
            if (lastSentEvent && lastSentEvent.getTs() >= event.getTs()) return;
        }

        this.lastSentReceiptEventId = eventId;
        const receiptType = SettingsStore.getValue("sendReadReceipts", this.opts.room.roomId)
            ? ReceiptType.Read
            : ReceiptType.ReadPrivate;

        debug(`[TimelineVM] sendAutoReadReceipt — sending receipt for ${eventId} (${receiptType})`);
        this.opts.client.sendReadReceipt(event, receiptType).catch((err) => {
            this.lastSentReceiptEventId = null; // allow retry
            logger.warn(`[TimelineVM] sendAutoReadReceipt — sendReadReceipt failed`, err);
        });
    }

    /**
     * Whether `eventId` comes after `than` in the room (true when there is nothing to compare with). By
     * position in the live timeline: timestamps are not an order, and bridged history shares them. An event
     * not in the live timeline is older than all of it.
     */
    private isAfter(eventId: string, than: string | null): boolean {
        if (!than || than === eventId) return !than;
        const live = this.opts.room.getLiveTimeline().getEvents();
        const at = live.findIndex((ev) => ev.getId() === eventId);
        const thanAt = live.findIndex((ev) => ev.getId() === than);
        if (at < 0)
            return (
                thanAt < 0 &&
                (this.opts.room.findEventById(eventId)?.getTs() ?? 0) >
                    (this.opts.room.findEventById(than)?.getTs() ?? 0)
            );
        return thanAt < 0 || at > thanAt;
    }

    /**
     * Whether the reader's own receipt, as the server has it, is at or after this event. Not the SDK's
     * hasUserReadEvent, which also counts anything at or before a message the reader sent as read: with the
     * newest message being the reader's own, no receipt went out at all, and what others had written before
     * it stayed unread on the server.
     */
    private receiptIsPast(eventId: string): boolean {
        const readUpTo = this.opts.room.getEventReadUpTo(this.opts.client.getSafeUserId(), true);
        if (!readUpTo) return false;
        if (readUpTo === eventId) return true;
        const live = this.opts.room.getLiveTimeline().getEvents();
        const receiptAt = live.findIndex((ev) => ev.getId() === readUpTo);
        if (receiptAt < 0) return false; // further back than the live timeline: behind anything here
        const eventAt = live.findIndex((ev) => ev.getId() === eventId);
        // An event not in the live timeline is older than all of it.
        return eventAt < 0 || receiptAt > eventAt;
    }

    private sendReceiptOnceBack(): void {
        if (this.presenceTimer) return;
        const timer = new Timer(READ_RECEIPT_DEBOUNCE_MS);
        this.presenceTimer = timer;
        // Started when the reader is active again, and aborted if they leave before it is through.
        UserActivity.sharedInstance().timeWhileActiveRecently(timer);
        timer.finished().then(
            () => {
                if (this.presenceTimer !== timer) return;
                this.presenceTimer = null;
                this.sendAutoReadReceipt();
            },
            () => {
                if (this.presenceTimer !== timer) return;
                this.presenceTimer = null;
                if (!this.isDisposed && this.active) this.sendReceiptOnceBack();
            },
        );
    }

    private stopWaitingForReader(): void {
        const timer = this.presenceTimer;
        this.presenceTimer = null;
        timer?.abort();
    }

    // ── Overlay button actions ───────────────────────────────────────

    public onJumpToReadMarker = (scrollNow: ImmediateScroll): void => {
        const items = this.snapshot.current.items;
        const rmIdx = items.findIndex((item) => item.kind === "read-marker");
        debug(
            `[TimelineVM] onJumpToReadMarker — frozenMarkerEventId=${this.frozenMarkerEventId}, ` +
                `rmIdx=${rmIdx}, items=${items.length}, ` +
                `visibleStartArrayIndex=${this.visibleStartArrayIndex}, ` +
                `canPaginate(Backward)=${this.timelineWindow.canPaginate(Direction.Backward)}, ` +
                `canJumpToReadMarker=${this.snapshot.current.canJumpToReadMarker}`,
        );
        if (rmIdx !== -1) {
            // Marker is in the loaded window — scroll to it imperatively.
            const readMarkerKey = items[rmIdx].key;
            debug(
                `[TimelineVM] onJumpToReadMarker — marker in window at index ${rmIdx}, scrolling now key=${readMarkerKey}`,
            );
            scrollNow({ targetKey: readMarkerKey, align: "center" });
        } else if (this.frozenMarkerEventId && this.timelineWindow.canPaginate(Direction.Backward)) {
            // Frozen marker is not in the current window — reload at it.
            // pendingAnchor gets set inside load() and drives the post-load scroll.
            debug(`[TimelineVM] onJumpToReadMarker — marker not in window, reloading at ${this.frozenMarkerEventId}`);
            void this.load({ kind: "permalink", eventId: this.frozenMarkerEventId });
        } else {
            logger.warn(
                `[TimelineVM] onJumpToReadMarker — no action taken: marker not in window (rmIdx=${rmIdx}) ` +
                    `and frozenMarkerEventId=${this.frozenMarkerEventId}, canPaginate(Backward)=${this.timelineWindow.canPaginate(Direction.Backward)}`,
            );
        }
    };

    public onMarkAllAsRead = (): void => {
        // Use the same logic as the room list "Mark as read" — receipts the last live event
        // in the room and clears the manually-marked-unread state. This ensures the grey dot
        // in the room list is cleared, regardless of the user's scroll position.
        clearRoomNotification(this.opts.room, this.opts.client).catch((err) => {
            logger.warn(`[TimelineVM] onMarkAllAsRead — clearRoomNotification failed`, err);
        });
        // Immediately clear the read marker line locally. This is an explicit
        // user action ("I have read everything"), so we override the per-session
        // freeze and drop the divider line.
        this.readMarkerEventId = null;
        this.frozenMarkerEventId = null;
        const newItems = this.buildItems(); // removes the read-marker item
        this.mergeSnapshot({ items: newItems, canJumpToReadMarker: false }, "mark-all-as-read");
    };

    public onJumpToLive = (scrollNow: ImmediateScroll): void => {
        debug(`[TimelineVM] onJumpToLive — atLiveEnd=${this.snapshot.current.atLiveEnd}`);
        if (!this.snapshot.current.atLiveEnd) {
            // The newest messages are not loaded, so fetch them first. load() sets
            // pendingAnchor, which is what makes the view scroll there once they arrive.
            void this.load({ kind: "live" });
        } else {
            // Already have the latest events — scroll to the last item now.
            const items = this.snapshot.current.items;
            if (items.length > 0) {
                const targetKey = items[items.length - 1].key;
                debug(`[TimelineVM] onJumpToLive — scrolling now to targetKey=${targetKey}`);
                this.mergeSnapshot({ numUnreadMessages: 0, hasHighlights: false }, "jump-to-live");
                scrollNow({ targetKey, align: "end" });
            } else {
                this.mergeSnapshot({ numUnreadMessages: 0, hasHighlights: false }, "jump-to-live-empty");
            }
        }
    };

    /** Telegram's "@" button: the oldest message that mentions the reader and has not been seen. */
    public onJumpToUnreadMention = (scrollNow: ImmediateScroll): void => {
        const target = this.takeOldest(
            [...this.unreadMentions].map(([id, ts]) => ({ id, ts })),
            (id) => this.forgetMention(id),
        );
        if (target) this.jumpToUnread(target, scrollNow, "onJumpToUnreadMention");
    };

    /** The heart button: the oldest of the reader's messages with a reaction they have not seen. */
    public onJumpToUnreadReaction = (scrollNow: ImmediateScroll): void => {
        const target = this.takeOldest(
            [...this.unreadReactions].map(([id, { ts }]) => ({ id, ts })),
            (id) => this.forgetReactions(id),
        );
        if (target) this.jumpToUnread(target, scrollNow, "onJumpToUnreadReaction");
    };

    /**
     * Pick the oldest of `entries` and take it out with `remove`: going to it is seeing it, so the next
     * tap goes on to the one after rather than back to the same message. The counts follow.
     */
    private takeOldest(entries: { id: string; ts: number }[], remove: (id: string) => boolean): string | undefined {
        let oldest: { id: string; ts: number } | undefined;
        for (const entry of entries) {
            if (!oldest || entry.ts < oldest.ts) oldest = entry;
        }
        if (!oldest) return undefined;
        remove(oldest.id);
        this.publishUnreadCounts();
        return oldest.id;
    }

    /**
     * Show `eventId` in the middle, marked, with the messages around it: a link opened while this timeline is
     * already up, because its room was open or was built before being opened. A timeline not started yet starts
     * there instead.
     */
    public jumpToEvent(eventId: string): void {
        const target = this.sentEventId(eventId);
        if (!target) return;
        if (!this.started) {
            this.opts.initialEventId = target;
            return;
        }
        debug(`[TimelineVM] jumpToEvent — loading at ${target}`);
        void this.load({ kind: "permalink", eventId: target });
    }

    /** Scroll to `eventId` where it is loaded, as {@link onJumpToReadMarker} does, and load it where it is not. */
    private jumpToUnread(eventId: string, scrollNow: ImmediateScroll, from: string): void {
        if (this.snapshot.current.items.some((item) => item.key === eventId)) {
            debug(`[TimelineVM] ${from} — in window, scrolling now key=${eventId}`);
            scrollNow({ targetKey: eventId, align: "center" });
        } else {
            // pendingAnchor gets set inside load() and drives the post-load scroll.
            debug(`[TimelineVM] ${from} — not in window, reloading at ${eventId}`);
            void this.load({ kind: "permalink", eventId });
        }
    }

    private unreadCounts(): Pick<TimelineViewSnapshot, "unreadMentions" | "unreadReactions"> {
        return { unreadMentions: this.unreadMentions.size, unreadReactions: this.unreadReactions.size };
    }

    private publishUnreadCounts(): void {
        this.mergeSnapshot(this.unreadCounts(), "unread-targets");
    }

    /**
     * Look for what was unread when the room was opened: the mentions of the reader, and the reactions to
     * their messages, among what was sent after the place they had read to. The later of the read
     * receipt and the FullyRead marker is that place (another device may have read on); with neither,
     * or one further back than what is held, all of what is held counts.
     *
     * The server's count of unread highlights has the last word on mentions: where it says there are
     * none, a message that merely looks like a mention (a rule evaluated again for old messages, say)
     * does not get a button; where it says fewer than we found, the newest of them are the unread ones.
     */
    private scanUnread(): void {
        if (this.scannedUnread) return;
        this.scannedUnread = true;

        const room = this.opts.room;
        const events = room.getLiveTimeline().getEvents();
        const readUpTo = [room.getEventReadUpTo(this.opts.client.getSafeUserId()), this.readMarkerEventId].map((id) =>
            id ? events.findIndex((event) => event.getId() === id) : -1,
        );
        const after = Math.max(...readUpTo) + 1;

        for (const event of events.slice(after)) this.noteUnreadCandidate(event, false);

        const highlights = room.getUnreadNotificationCount(NotificationCountType.Highlight) ?? 0;
        if (this.unreadMentions.size > highlights) {
            const newest = [...this.unreadMentions].sort((a, b) => b[1] - a[1]).slice(0, highlights);
            this.unreadMentions = new Map(newest);
        }
    }

    /**
     * Sort one event into the mentions or the reactions to look at, if it is one. `live` is whether it
     * has just arrived, in which case what the reader is looking at already is not news to them.
     */
    private noteUnreadCandidate(event: MatrixEvent, live: boolean): void {
        const id = event.getId();
        if (!id || event.isRedacted()) return;
        const me = this.opts.client.getSafeUserId();
        if (event.getSender() === me) return;

        if (
            event.getWireType() === EventType.RoomMessageEncrypted &&
            !event.isDecryptionFailure() &&
            event.getClearContent() === null
        ) {
            // What it is is not known yet.
            this.undecryptedUnread.add(id);
            return;
        }

        if (event.getType() === EventType.Reaction) {
            if (this.seen.has(id)) return;
            const targetId = event.getRelation()?.event_id;
            const target = targetId ? this.opts.room.findEventById(targetId) : undefined;
            if (targetId && !target) {
                void this.checkReactionTarget(event, targetId);
                return;
            }
            if (!targetId || target?.getSender() !== me) return;
            if (live && this.isOnScreen(targetId)) return;
            const entry = this.unreadReactions.get(targetId) ?? { ts: target.getTs(), reactions: new Set<string>() };
            entry.reactions.add(id);
            this.unreadReactions.set(targetId, entry);
            return;
        }

        // An edit of a message is not a message; the original is what mentions (or does not).
        if (event.isRelation(RelationType.Replace)) return;
        if (this.seen.has(id)) return;
        if (!this.mentionsReader(event)) return;
        if (!this.shouldIncludeEvent(event, !!SettingsStore.getValue("showHiddenEventsInTimeline"))) return;
        // Arriving while the reader is at the bottom of the room it is open in, it is read as it comes.
        if (live && this.active && this.isAtBottom && this.snapshot.current.atLiveEnd) return;
        this.unreadMentions.set(id, event.getTs());
    }

    /** Whether an event is for the reader by name: a highlight under their push rules, or an `m.mentions` of them or of the room. */
    private mentionsReader(event: MatrixEvent): boolean {
        if (this.opts.client.getPushActionsForEvent(event)?.tweaks?.highlight) return true;
        const mentions = event.getContent()["m.mentions"];
        return (
            !!mentions && (mentions.room === true || !!mentions.user_ids?.includes(this.opts.client.getSafeUserId()))
        );
    }

    /** Whether a row is where the reader is looking now. */
    private isOnScreen(eventId: string): boolean {
        if (!this.active) return false;
        const items = this.snapshot.current.items;
        for (let i = this.visibleStartArrayIndex; i <= this.visibleEndArrayIndex; i++) {
            if (items[i]?.key === eventId) return true;
        }
        return false;
    }

    private get seen(): Set<string> {
        this.seenUnread ??= readSeenUnread(this.opts.room.roomId);
        return this.seenUnread;
    }

    /** A mention is no longer news: kept as seen for later sessions too. */
    private forgetMention(id: string): boolean {
        if (!this.unreadMentions.delete(id)) return false;
        rememberSeenUnread(this.opts.room.roomId, this.seen, [id]);
        return true;
    }

    /** Nor are the reactions to this message of the reader's. */
    private forgetReactions(targetId: string): boolean {
        const entry = this.unreadReactions.get(targetId);
        if (!entry) return false;
        this.unreadReactions.delete(targetId);
        rememberSeenUnread(this.opts.room.roomId, this.seen, entry.reactions);
        return true;
    }

    /**
     * A reaction to a message that is not in memory: whether it is one of the reader's can only be told by
     * fetching it. Without this, reactions to older messages never got the heart button.
     */
    private async checkReactionTarget(reaction: MatrixEvent, targetId: string): Promise<void> {
        if (this.checkingTargets.has(targetId)) return;
        this.checkingTargets.add(targetId);
        try {
            const raw = await this.opts.client.fetchRoomEvent(this.opts.room.roomId, targetId);
            if (this.isDisposed || raw.sender !== this.opts.client.getSafeUserId()) return;
            const entry = this.unreadReactions.get(targetId) ?? {
                ts: raw.origin_server_ts ?? 0,
                reactions: new Set<string>(),
            };
            entry.reactions.add(reaction.getId()!);
            this.unreadReactions.set(targetId, entry);
            this.publishUnreadCounts();
        } catch {
            // Gone or not visible to us: nothing to jump to.
        } finally {
            this.checkingTargets.delete(targetId);
        }
    }

    /** What is in rows `startIndex` to `endIndex` has been seen: it is no longer unread. */
    private markSeen(items: TimelineItem[], startIndex: number, endIndex: number): void {
        if (this.unreadMentions.size === 0 && this.unreadReactions.size === 0) return;
        let changed = false;
        for (let i = Math.max(0, startIndex); i <= endIndex && i < items.length; i++) {
            const item = items[i];
            if (item.kind !== "event") continue;
            changed = this.forgetMention(item.key) || changed;
            changed = this.forgetReactions(item.key) || changed;
        }
        if (changed) this.publishUnreadCounts();
    }

    /** A redaction: of a mention, which is then not worth going to, or of a reaction. */
    private onRoomRedaction = (event: MatrixEvent): void => {
        if (this.isDisposed) return;
        const redacted = event.getAssociatedId();
        if (!redacted) return;
        let changed = this.unreadMentions.delete(redacted);
        for (const [targetId, entry] of this.unreadReactions) {
            if (entry.reactions.delete(redacted) && entry.reactions.size === 0) {
                this.unreadReactions.delete(targetId);
                changed = true;
            }
        }
        if (changed) this.publishUnreadCounts();
    };

    /**
     * Derive whether the "Jump to unread" bar should be shown and in which direction.
     * - `"above"` — marker is above the visible start (or above the loaded window).
     * - `"below"` — marker is below the visible end (within the loaded window).
     * - `false`   — marker is visible, not set, or unreachable.
     *
     * The marker row may have been stripped from `items` by the trailing-strip
     * Driven by `frozenMarkerEventId` (the session-pinned snapshot), not the
     * live server-side `readMarkerEventId`. If the freeze was `null` (no marker
     * or fully read on entry) the button is never offered this session.
     */
    private computeCanJumpToReadMarker(items: TimelineItem[]): "above" | "below" | false {
        if (!this.frozenMarkerEventId) return false;
        // Read past it already: nothing above is unread any more, as in Telegram. The button stayed for the
        // whole visit, offering to go back to what had just been read.
        // Only a marker in the loaded room: one older than all of it has unread, unseen messages after it.
        if (this.seenUpToId) {
            const live = this.opts.room.getLiveTimeline().getEvents();
            const markerAt = live.findIndex((ev) => ev.getId() === this.frozenMarkerEventId);
            const seenAt = live.findIndex((ev) => ev.getId() === this.seenUpToId);
            if (markerAt >= 0 && seenAt > markerAt) return false;
        }

        const events = this.timelineWindow.getEvents();
        const markerInWindow = events.some((e) => e.getId() === this.frozenMarkerEventId);

        const rmIdx = items.findIndex((item) => item.kind === "read-marker");
        if (rmIdx === -1) {
            if (markerInWindow) {
                // Marker event is in the window but didn't make it into the rendered
                // items — likely a filtered event. Don't show a misleading button.
                return false;
            }
            // Marker is genuinely outside the loaded window. Direction depends on
            // which side has unloaded events. If forward pagination is possible,
            // the marker is newer than our window (e.g. the user has back-paginated
            // past the live edge and the marker fell off via window trimming):
            // "below". Otherwise the marker is older than our window: "above".
            if (this.timelineWindow.canPaginate(Direction.Forward)) return "below";
            if (this.timelineWindow.canPaginate(Direction.Backward)) return "above";
            return false;
        }
        if (rmIdx < this.visibleStartArrayIndex) return "above";
        if (rmIdx > this.visibleEndArrayIndex) return "below";
        return false;
    }

    /**
     * Tear-down: save scroll position and advance the FullyRead marker.
     *
     * - Saves the current scroll position to localStorage so the next visit
     *   resumes here. Clears the saved position only when the user is at the
     *   visual bottom (so the next visit starts fresh at the live end).
     * - Advances the FullyRead marker to the last bottommost event we've seen
     *   during this session, so the next time the user enters the room the
     *   "unread divider" reflects what they've actually read. We deliberately
     *   do this only on dispose, not during scrolling — see
     *   {@link sendAutoReadReceipt} for the rationale.
     */
    public override dispose(): void {
        for (const timer of this.paginateRetryTimers.values()) clearTimeout(timer);
        if (this.onlineListener) window.removeEventListener("online", this.onlineListener);
        if (this.decryptDebounceTimer !== null) {
            clearTimeout(this.decryptDebounceTimer);
            this.decryptDebounceTimer = null;
        }
        this.leave();
        super.dispose();
    }

    /** Whether this room is the one on screen (see {@link setActive}). */
    private active = true;

    /**
     * Whether this room is the one on screen.
     *
     * A room switched away from stays mounted behind the one on screen, so switching back is instant
     * (Telegram keeps the chats it has shown); while it is behind, it must not act as if it were being
     * read. Going off screen does what leaving the room did - its place is saved and the FullyRead
     * marker advanced - and no read receipt is sent until it is on screen again.
     */
    public setActive(active: boolean): void {
        if (active === this.active) return;
        this.active = active;
        if (active) {
            debug(`[TimelineVM] setActive(true) — back on screen`);
            // Coming back is a new visit: the line goes to where the reader got to on the last one,
            // or goes away. Left where the first visit put it, it kept standing over messages read
            // long since, the reader's own among them.
            if (this.started && this.snapshot.current.items.length > 0) {
                this.freezeReadMarkerForSession();
                const items = this.buildItems();
                /*
                 * And it opens where Telegram opens a chat: at the first message not yet read, or at the
                 * newest - not wherever the last visit's scrolling was left. That place was kept, while
                 * the messages that arrived meanwhile were added out of sight and never measured, so the
                 * reader came back to the old place with the new messages missing until they scrolled.
                 */
                const marker = items.find((item) => item.kind === "read-marker");
                const atLiveEnd = this.windowAtLiveEnd();
                let pendingAnchor: NavigationAnchor | null = null;
                if (marker) pendingAnchor = { targetKey: marker.key, align: "start", settle: true };
                else if (atLiveEnd)
                    pendingAnchor = { targetKey: items[items.length - 1].key, align: "end", settle: true };
                this.mergeSnapshot(
                    {
                        items,
                        canJumpToReadMarker: this.computeCanJumpToReadMarker(items),
                        ...(pendingAnchor ? { pendingAnchor } : {}),
                    },
                    "back-on-screen",
                );
                // Neither is loaded: the first unread is further on than the window reaches, or the
                // reader had gone back into history and the newest messages were let go.
                if (!pendingAnchor) {
                    void this.load(
                        this.frozenMarkerEventId
                            ? { kind: "permalink", eventId: this.frozenMarkerEventId }
                            : { kind: "live" },
                    );
                }
            }
            this.sendAutoReadReceipt();
        } else {
            debug(`[TimelineVM] setActive(false) — off screen`);
            this.leave();
        }
    }

    /** What leaving the room does: stop receipting, save the place, advance the FullyRead marker. */
    private leave(): void {
        if (this.readReceiptDebounceTimer !== null) {
            clearTimeout(this.readReceiptDebounceTimer);
            this.readReceiptDebounceTimer = null;
        }
        this.stopWaitingForReader();
        if (!this.lastBottomEventId) {
            debug(`[TimelineVM] leave() — no visible range recorded, preserving saved position`);
            return;
        }

        if (this.isAtBottom) {
            debug(`[TimelineVM] leave() — clearing saved scroll position (at visual bottom)`);
            RoomTimelineViewModel.saveScrollTarget(this.opts.room.roomId, null);
        } else {
            debug(`[TimelineVM] leave() — saving scroll position eventId=${this.lastBottomEventId}`);
            RoomTimelineViewModel.saveScrollTarget(this.opts.room.roomId, this.lastBottomEventId);
        }

        // Advance the FullyRead marker to the last event the reader got to the end of: the same one
        // read receipts go by, so the "New" line is not put after a message that only showed a line.
        // Skip if it already matches what we last advanced to (avoids redundant network calls).
        const readTo = this.readableEventId;
        if (readTo && readTo !== this.readMarkerEventId) {
            debug(`[TimelineVM] leave() — advancing FullyRead marker to ${readTo}`);
            // Known here at once, not when the server has said it back: the reader may return first.
            const previous = this.readMarkerEventId;
            this.readMarkerEventId = readTo;
            this.opts.client.setRoomReadMarkers(this.opts.room.roomId, readTo).catch((err) => {
                if (this.readMarkerEventId === readTo) this.readMarkerEventId = previous;
                logger.warn(`[TimelineVM] leave() — setRoomReadMarkers failed`, err);
            });
        }
    }

    // ── Pagination ───────────────────────────────────────────────────

    /**
     * Asks for older messages. Only one fetch runs at a time; a request that arrives
     * while one is running is remembered and run afterwards — see
     * {@link backwardRerunRequested} for why it cannot just be dropped.
     */
    private triggerBackwardPaginate(): void {
        if (this.backwardPaginateChain) {
            // Remember it rather than dropping it; see backwardRerunRequested.
            this.backwardRerunRequested = true;
            debug(`[TimelineVM] paginate(backward) coalesced — chain in flight, rerun queued`);
            return;
        }

        // Hold off while the first load is still scrolling into place. Rows that have not been
        // measured yet have no height, so the view can briefly think both ends are on screen and
        // ask for more history it does not need — which also disturbs the placement. Once the
        // anchor settles the view clears pendingAnchor, and the reader's own scrolling asks again.
        if (this.snapshot.current.pendingAnchor !== null) {
            debug(`[TimelineVM] paginate(backward) skipped — anchor placement pending`);
            return;
        }

        if (!this.timelineWindow.canPaginate(Direction.Backward)) {
            debug(`[TimelineVM] paginate(backward) skipped — canPaginate=false`);
            return;
        }

        if (this.isHeld(Direction.Backward)) return;

        this.backwardPaginateChain = this.runPaginateChain(Direction.Backward).finally(() => {
            this.backwardPaginateChain = null;
            if (this.initialFillInFlight) {
                this.initialFillInFlight = false;
                // A list opened short has its first row on screen, so the view asks for older
                // messages too, moments after we did. That fetch was already the answer to it, and
                // running a second one would double the history requested by every room opened.
                // Only while the list is still short is the request kept: the view may not ask again.
                if (this.renderableEventCount(undefined, Direction.Backward) >= MIN_INITIAL_EVENTS) {
                    this.backwardRerunRequested = false;
                }
            }
            if (this.backwardRerunRequested && !this.isDisposed) {
                this.backwardRerunRequested = false;
                debug(`[TimelineVM] paginate(backward) — running queued rerun`);
                this.triggerBackwardPaginate();
            }
        });
    }

    /**
     * Entry point for forward pagination. Coalesces concurrent `onEndReached`
     * calls behind a single in-flight chain.
     */
    private triggerForwardPaginate(): void {
        if (this.forwardPaginateChain) {
            // Remember it rather than dropping it; see backwardRerunRequested.
            this.forwardRerunRequested = true;
            debug(`[TimelineVM] paginate(forward) coalesced — chain in flight, rerun queued`);
            return;
        }

        // Wait until the first messages have been positioned; see triggerBackwardPaginate.
        if (this.snapshot.current.pendingAnchor !== null) {
            debug(`[TimelineVM] paginate(forward) skipped — anchor placement pending`);
            return;
        }

        debug(
            `[TimelineVM] paginate(forward) check — canPaginate=${this.timelineWindow.canPaginate(Direction.Forward)}, ` +
                `atLiveEnd=${this.snapshot.current.atLiveEnd}, items=${this.snapshot.current.items.length}`,
        );

        if (this.windowAtLiveEnd()) {
            debug(`[TimelineVM] paginate(forward) skipped — canPaginate=false`);
            if (!this.snapshot.current.atLiveEnd) {
                debug(`[TimelineVM] paginate(forward) — setting atLiveEnd=true`);
                this.mergeSnapshot({ atLiveEnd: true }, "paginate(forward)-at-live-end");
            }
            return;
        }

        if (this.isHeld(Direction.Forward)) return;

        this.forwardPaginateChain = this.runPaginateChain(Direction.Forward).finally(() => {
            this.forwardPaginateChain = null;
            if (this.forwardRerunRequested && !this.isDisposed) {
                this.forwardRerunRequested = false;
                debug(`[TimelineVM] paginate(forward) — running queued rerun`);
                this.triggerForwardPaginate();
            }
        });
    }

    /**
     * Keys for the two loading spinners. {@link republish} adds these to the list on the way
     * out to the view and they are never kept in {@link baseItems}, so each can appear at most
     * once per end.
     *
     * They are ordinary list rows rather than something fixed above or below the list. That way
     * the view measures their height like any other row and can absorb one appearing or
     * disappearing without the messages jumping.
     */
    private static readonly BACKWARD_LOADING_KEY = "backward-loading";
    private static readonly FORWARD_LOADING_KEY = "forward-loading";

    /**
     * Publish {@link baseItems} to the View, layering spinners on top:
     * `[ (backward?), ...baseItems, (forward?) ]`.
     */
    private republish(reason: string, extra: Partial<TimelineViewSnapshot> = {}): void {
        const items: TimelineItem[] = [];
        if (this.backwardSpinnerVisible) {
            items.push({ kind: "loading", key: RoomTimelineViewModel.BACKWARD_LOADING_KEY });
        }
        items.push(...this.baseItems);
        if (this.forwardSpinnerVisible) {
            items.push({ kind: "loading", key: RoomTimelineViewModel.FORWARD_LOADING_KEY });
        }
        const isEmpty =
            this.loaded &&
            items.length === 0 &&
            !this.timelineWindow.canPaginate(Direction.Backward) &&
            !this.timelineWindow.canPaginate(Direction.Forward);
        this.mergeSnapshot({ items, isEmpty, ...extra }, reason);
    }

    /**
     * Swap {@link baseItems} for a freshly-built array and report how many events newly
     * entered. Scroll position is preserved by the virtualizer's own key-based anchoring,
     * so no index bookkeeping is needed here.
     *
     * @returns the number of events that newly entered the list — the only reliable
     *   progress signal for the paginate loop once trimming has made net array length
     *   meaningless.
     */
    private commitItems(rebuilt: TimelineItem[]): number {
        const oldEventKeys = new Set<string>();
        for (const item of this.baseItems) {
            if (item.kind === "event") oldEventKeys.add(item.key);
        }

        let newlyShown = 0;
        for (const item of rebuilt) {
            if (item.kind === "event" && !oldEventKeys.has(item.key)) newlyShown++;
        }

        this.baseItems = rebuilt;
        return newlyShown;
    }

    /**
     * Stage the window's far-end trim as its own update *before* extending the
     * near end, so the virtualizer never sees an add-at-one-end + trim-at-the-other in a
     * single change.
     *
     * The virtualizer only holds scroll position when an update is "pure": items added
     * or removed at the top (it compensates scrollTop) or added at the bottom (no
     * compensation needed). An update that extends one end and trims the other is neither,
     * and rather than guess how far to adjust the virtualizer stops compensating altogether —
     * so the viewport shifts by the height of whatever was trimmed. At the window cap the
     * SDK's `paginate()` does exactly that combination, which is the on-append scroll jump.
     *
     * So when a paginate is about to overflow {@link WINDOW_LIMIT}, we first
     * `unpaginate()` the far end ourselves and publish that as a standalone,
     * compensated trim, then yield a frame. The subsequent `paginate()` now has
     * room and lands as a pure extend. Both directions are covered by the shared
     * chain: forward extends the end so we trim the start; backward is the mirror.
     *
     * Below the cap `toTrim <= 0` and this is a no-op — the normal pure-append /
     * pure-prepend path is untouched.
     */
    private async makeRoomBeforeExtending(direction: Direction, dirLabel: string): Promise<void> {
        const windowSize = this.timelineWindow.getEvents().length;
        const toTrim = windowSize + PAGINATE_SIZE - WINDOW_LIMIT;
        if (toTrim <= 0) return;

        // Forward extends the end, so the SDK would trim the start (startOfTimeline=true);
        // backward extends the start, so it would trim the end. Mirror that here.
        const trimStartOfTimeline = direction === Direction.Forward;
        try {
            this.timelineWindow.unpaginate(toTrim, trimStartOfTimeline);
        } catch (e) {
            // Defensive: if the window can't give back this many events we simply
            // skip the pre-trim and let paginate() do its combined extend+trim.
            logger.warn(`[TimelineVM] makeRoomBeforeExtending — unpaginate(${toTrim}) failed, falling back`, e);
            return;
        }

        const newlyShown = this.commitItems(this.buildItems());
        debug(
            `[TimelineVM] paginate(${dirLabel}) pre-trim — unpaginated=${toTrim} ` +
                `(window→${this.timelineWindow.getEvents().length}), newlyShown=${newlyShown}`,
        );
        this.republish(`paginate(${dirLabel})-trim`, {
            atLiveEnd: this.windowAtLiveEnd(),
            canJumpToReadMarker: this.computeCanJumpToReadMarker(this.baseItems),
        });

        // Yield a frame so React commits the trim and the virtualizer applies its scroll
        // compensation before we publish the extend in the next update.
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }

    /**
     * Fetches more history in one direction. Used for both ends; `direction` says which.
     *
     * It loops rather than fetching once, because a batch from the server can turn out to
     * contain nothing we display — a run of membership changes or other hidden events. Rather
     * than finish having added no rows, we keep asking until something showable arrives, we run
     * out of history, or we hit `MAX_EMPTY_RETRIES`. The spinner stays up for the whole loop, so
     * however many batches that takes it reads as one wait rather than a flicker per batch.
     *
     * Rows are published after each batch. Encrypted messages appear straight away, before they
     * are decrypted; decryption later changes what a row contains but never adds or removes
     * rows, so it cannot disturb the list from here.
     *
     * Both directions hand the rebuilt list over via {@link commitItems}, and the view keeps the
     * reader's place by message id, so nothing here needs to care which end the SDK dropped
     * messages from. The one real difference is `atLiveEnd`: once the window is full, paginating
     * backwards trims the newest messages, which flips that flag from true to false as a side
     * effect. It gates the view's stick-to-bottom, so leaving a stale `true` in place would drag
     * the reader to the bottom if a message arrived mid-chain — hence we republish it after every
     * backward batch. Forward pagination only ever trims the oldest, so it cannot touch the flag
     * and one check once the loop finishes is enough.
     */
    /** Whether a failed page is still being waited out in this direction; if so, it is asked for after. */
    private isHeld(direction: Direction): boolean {
        const hold = this.paginateHold.get(direction);
        if (!hold || Date.now() >= hold.until) return false;
        hold.wanted = true;
        debug(`[TimelineVM] paginate held — retry in ${hold.until - Date.now()}ms`);
        return true;
    }

    /**
     * A page failed: wait before asking again, twice as long each time up to a minute - and while the
     * browser is offline, until it is back, then at once.
     */
    private holdAfterFailure(direction: Direction): void {
        const previous = this.paginateHold.get(direction)?.backoffMs ?? 0;
        const backoffMs = Math.min(Math.max(PAGINATE_RETRY_MIN_MS, previous * 2), PAGINATE_RETRY_MAX_MS);
        const offline = typeof navigator !== "undefined" && navigator.onLine === false;
        this.paginateHold.set(direction, {
            until: offline ? Number.POSITIVE_INFINITY : Date.now() + backoffMs,
            backoffMs,
            wanted: false,
        });
        const retry = (): void => {
            if (this.isDisposed) return;
            const hold = this.paginateHold.get(direction);
            if (!hold) return;
            hold.until = 0;
            if (!hold.wanted) return;
            if (direction === Direction.Backward) this.triggerBackwardPaginate();
            else this.triggerForwardPaginate();
        };
        clearTimeout(this.paginateRetryTimers.get(direction));
        if (offline) {
            if (!this.onlineListener) {
                this.onlineListener = (): void => {
                    window.removeEventListener("online", this.onlineListener!);
                    this.onlineListener = undefined;
                    for (const [dir, hold] of this.paginateHold) {
                        hold.until = 0;
                        if (!hold.wanted) continue;
                        if (dir === Direction.Backward) this.triggerBackwardPaginate();
                        else this.triggerForwardPaginate();
                    }
                };
                window.addEventListener("online", this.onlineListener);
            }
        } else {
            this.paginateRetryTimers.set(direction, setTimeout(retry, backoffMs));
        }
    }

    private async runPaginateChain(direction: Direction): Promise<void> {
        // A backstop: the loop already stops when canPaginate() or hasMore say
        // there is no more history. This caps how long it can keep fetching nothing displayable
        // off the back of a single scroll — after this many empty batches we stop and wait for the
        // reader to scroll again rather than walk the whole room unprompted.
        const MAX_EMPTY_RETRIES = 10;
        const isBackward = direction === Direction.Backward;
        const dirLabel = isBackward ? "backward" : "forward";

        if (isBackward) {
            this.backwardSpinnerVisible = true;
            this.republish("paginate(backward)-start");
        } else {
            this.forwardSpinnerVisible = true;
            this.republish("paginate(forward)-start");
        }

        try {
            let emptyBatches = 0;

            while (emptyBatches <= MAX_EMPTY_RETRIES) {
                if (!this.timelineWindow.canPaginate(direction)) {
                    debug(`[TimelineVM] paginate(${dirLabel}) chain end — canPaginate=false`);
                    break;
                }

                // If this paginate would overflow the window cap, stage the
                // far-end trim as its own compensated update first so the extend
                // below lands as a pure add (no on-append scroll jump). No-op
                // below the cap.
                await this.makeRoomBeforeExtending(direction, dirLabel);
                if (this.isDisposed) return;

                const eventsBefore = new Set(this.timelineWindow.getEvents());
                const hasMore = await this.timelineWindow.paginate(direction, PAGINATE_SIZE);
                if (this.isDisposed) return;
                const eventsAfter = this.timelineWindow.getEvents();

                // Give newly-fetched encrypted messages a moment to decrypt, so buildItems can
                // see what they really are and decide once whether to show them. Any that take
                // longer are added by onEventDecrypted when they finish.
                const newEvents = eventsAfter.filter((e) => !eventsBefore.has(e));
                if (newEvents.length > 0) {
                    await this.waitForDecryption(newEvents, PAGINATE_DECRYPT_WAIT_MS);
                    if (this.isDisposed) return;
                }

                const rebuilt = this.buildItems();

                // `newlyShown` counts the events that newly entered the list. Once the window is
                // trimming at its limit the array length alone says nothing, so this is the only
                // reliable signal that the batch made progress.
                const newlyShown = this.commitItems(rebuilt);
                debug(`[TimelineVM] paginate(${dirLabel}) batch — newlyShown=${newlyShown}, hasMore=${hasMore}`);

                if (isBackward) {
                    this.republish("paginate(backward)-batch", {
                        // Backward pagination can trim the newest messages away once the window is
                        // full, so re-check whether we are still at the live end.
                        atLiveEnd: this.windowAtLiveEnd(),
                        canJumpToReadMarker: this.computeCanJumpToReadMarker(rebuilt),
                    });
                } else {
                    this.republish("paginate(forward)-batch", {
                        canJumpToReadMarker: this.computeCanJumpToReadMarker(rebuilt),
                    });
                }

                if (newlyShown > 0 || !hasMore) break;
                emptyBatches++;
            }

            this.paginateHold.delete(direction);
            if (isBackward) {
                this.backwardSpinnerVisible = false;
                this.republish("paginate(backward)-end", {
                    atLiveEnd: this.windowAtLiveEnd(),
                });
            } else {
                this.forwardSpinnerVisible = false;
                this.republish("paginate(forward)-end", {
                    atLiveEnd: this.windowAtLiveEnd(),
                });
            }
        } catch (e) {
            logger.error(`[TimelineVM] paginate(${dirLabel}) error`, e);
            this.holdAfterFailure(direction);
            if (isBackward) {
                this.backwardSpinnerVisible = false;
                this.republish("paginate(backward)-error");
            } else {
                this.forwardSpinnerVisible = false;
                this.republish("paginate(forward)-error");
            }
        }
    }

    // ── Snapshot construction ────────────────────────────────────────

    private static readonly CONTINUATION_MAX_INTERVAL = 5 * 60 * 1000;
    private static readonly CONTINUED_TYPES = new Set(["m.room.message", "m.sticker"]);

    private buildItems(): TimelineItem[] {
        /*
         * A message you just sent is not in the timeline yet: until the server echoes it back the
         * room holds it as a pending event, and the window knows nothing about it. Without these
         * the message only appears once the round trip finishes, which reads as the app having
         * swallowed it. At the live end they all belong; away from it, only the ones that failed
         * (pendingEventsToShow) - a failed message never arrives by scrolling, and after a gappy sync
         * the window says it can page forward while the reader is at the bottom, which left failed
         * messages nowhere on screen.
         */
        const windowIds = new Set(this.timelineWindow.getEvents().map((e) => e.getId()));
        const pending = pendingEventsToShow(this.opts.room.getPendingEvents(), this.windowAtLiveEnd()).filter(
            (event) => {
                const id = event.getId();
                return !!id && !windowIds.has(id);
            },
        );
        const events: MatrixEvent[] = [...this.timelineWindow.getEvents(), ...pending];
        const items: TimelineItem[] = [];
        let lastDate: string | null = null;
        let prevEvent: MatrixEvent | null = null;
        let filteredCount = 0;
        // Tracks which date keys have already had a separator emitted. Rooms
        // with out-of-order server-clock events can produce a timeline where the
        // same calendar date appears in multiple non-contiguous runs. Without
        // this guard, `buildItems` would emit a second separator with the same
        // key, causing a React key collision and the virtualizer rendering the same
        // separator slot multiple times in the DOM.
        const emittedDateKeys = new Set<string>();

        const showHiddenEvents = SettingsStore.getValue("showHiddenEventsInTimeline");
        // Suppress the leading date separator when more history is available
        // behind the current window — the backward pagination spinner
        // visually fills that role, matching the legacy `MessagePanel`
        // behaviour (see `wantsSeparator` in MessagePanel.tsx). Once we've
        // hit the start of the timeline we let the leading separator render
        // so the user sees an explicit "this is the start" marker.
        const suppressLeadingSeparator = this.timelineWindow.canPaginate(Direction.Backward);

        for (const event of events) {
            const eventId = event.getId();
            if (!eventId) continue;

            // Messages still being decrypted are left out, so the view never measures a small
            // placeholder it has to swap for a full message a moment later — the repeated
            // re-measuring was the original cause of the timeline going blank. They are added at
            // their real size once decryption finishes (see onEventDecrypted).
            if (!this.shouldIncludeEvent(event, showHiddenEvents)) {
                filteredCount++;
                continue;
            }

            // Insert date separator when the day changes (or for the very
            // first event when we're at the start of the timeline). Only
            // reached for events that pass the inclusion filter, so
            // separators are never orphaned.
            const eventDate = new Date(event.getTs());
            const dateKey = eventDate.toDateString();
            const isLeadingEvent = lastDate === null;
            if (
                dateKey !== lastDate &&
                !emittedDateKeys.has(dateKey) &&
                !(isLeadingEvent && suppressLeadingSeparator)
            ) {
                items.push({
                    key: `date-${dateKey}`,
                    kind: "date-separator",
                    ts: event.getTs(),
                });
                emittedDateKeys.add(dateKey);
                prevEvent = null; // date separator breaks continuation
            }
            // Track the most recently seen day even when we suppressed the
            // separator so we still emit one when the day changes mid-list.
            lastDate = dateKey;

            items.push({
                key: eventId,
                kind: "event",
                continuation: this.getCachedContinuation(eventId, prevEvent, event),
                lastInSection: false, // computed in the post-pass below, once the next event is known
            });

            // Insert the read-marker item directly after the event it belongs to.
            // Uses the per-session frozen marker so the divider position never
            // changes during the session (see {@link freezeReadMarkerForSession}).
            // Works correctly for wire-encrypted anchors too, because the slot
            // exists immediately.
            if (this.frozenMarkerEventId && eventId === this.frozenMarkerEventId) {
                items.push({ key: "read-marker", kind: "read-marker" });
            }

            prevEvent = this.frozenMarkerEventId === eventId ? null : event;
        }

        /*
         * "New" marks where the messages the reader has not seen begin. With nothing drawn after it,
         * it marks nothing: a room whose only events since the reader's last message are ones that get
         * no row (a bridge writing its state, a member's profile changing) ended in a "New" pill over an
         * empty space. Only at the live end, though - further back, what follows it is not loaded yet.
         */
        if (items[items.length - 1]?.kind === "read-marker" && this.windowAtLiveEnd()) {
            items.pop();
        }

        // Separators close sender runs as well as sender changes. Keep individual
        // message keys stable; the closing corner and avatar don't change row height.
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const next = items[i + 1];
            if (item.kind === "event") {
                item.lastInSection = next?.kind !== "event" || !next.continuation;
            }
        }

        debug(
            `[TimelineVM][buildItems] emitted ${items.length} items from ${events.length} window events, ` +
                `filtered=${filteredCount}`,
        );

        return items;
    }

    /**
     * Whether this event should get a row of its own. Re-decided on every {@link buildItems}.
     *
     * An encrypted message still being decrypted is left out for the moment. Showing one would
     * put a small placeholder in the list that grows into a full message moments later, pushing
     * everything below it down; it appears at its real size on the next rebuild instead, which
     * happens as soon as decryption finishes.
     *
     * A message that has *failed* to decrypt is different, and is shown — as the usual "unable to
     * decrypt" tile. That state can last indefinitely (the keys may never arrive), so hiding it
     * would quietly drop the message from the room rather than briefly delay it.
     *
     * Once decrypted, whether it gets a row depends on what it turned out to be: a message
     * does, but things that only modify other messages — reactions, edits — do not, matching
     * what the existing timeline shows.
     */
    private shouldIncludeEvent(event: MatrixEvent, showHiddenEvents: boolean): boolean {
        const eventId = event.getId();
        if (!eventId) return false;

        // Encrypted and still decrypting — leave it out until we know what it is. Note the
        // isDecryptionFailure check: one that has already failed is shown, not held back.
        // onEventDecrypted brings in whatever resolves later.
        if (
            event.getWireType() === EventType.RoomMessageEncrypted &&
            !event.isDecryptionFailure() &&
            event.getClearContent() === null
        ) {
            return false;
        }

        return this.computeInclusion(event, showHiddenEvents);
    }

    private computeInclusion(event: MatrixEvent, showHiddenEvents: boolean): boolean {
        // shouldHideEvent catches edits (m.replace), poll-end events,
        // redacted-when-hidden, member events filtered by display prefs, etc.
        if (shouldHideEvent(event)) return false;

        if (!haveRendererForEvent(event, this.opts.client, showHiddenEvents)) return false;

        // Also require a concrete native factory. `haveRendererForEvent`
        // returns true if a module-registered custom-component hint exists
        // for the event (see `customComponents.getHintsForMessage`), even
        // when no native EVENT_TILE_TYPES factory matches. EventTile's
        // rendering decision uses `!!pickFactory(...)` directly though, so
        // an event in that "hinted but no factory" gap would slip into items
        // and then render as the "could not be displayed" fallback tile.
        // Custom event types like `org.element.doc.delta` fall into this
        // gap. Filtering them at the VM keeps the timeline clean.
        return !!pickFactory(event, this.opts.client, showHiddenEvents);
    }

    /**
     * Return the continuation flag for `event`, using a cached value if we
     * have already seen the event before. See `continuationCache` for why.
     */
    private getCachedContinuation(eventId: string, prev: MatrixEvent | null, cur: MatrixEvent): boolean {
        if (!prev) {
            this.continuationCache.set(eventId, false);
            return false;
        }
        const cached = this.continuationCache.get(eventId);
        if (cached !== undefined) return cached;
        const value = this.shouldFormContinuation(prev, cur);
        this.continuationCache.set(eventId, value);
        return value;
    }

    private shouldFormContinuation(prev: MatrixEvent | null, cur: MatrixEvent): boolean {
        if (!prev?.sender || !cur.sender) return false;
        if (hasThreadSummary(prev) || hasThreadSummary(cur)) return false;
        const previousProfile = getPerMessageProfile(prev);
        const currentProfile = getPerMessageProfile(cur);
        if (
            previousProfile?.displayname !== currentProfile?.displayname ||
            previousProfile?.avatar_url !== currentProfile?.avatar_url ||
            previousProfile?.id !== currentProfile?.id
        )
            return false;
        if (cur.getTs() - prev.getTs() > RoomTimelineViewModel.CONTINUATION_MAX_INTERVAL) return false;
        if (cur.isRedacted() !== prev.isRedacted()) return false;
        const curType = cur.getType();
        const prevType = prev.getType();
        const ct = RoomTimelineViewModel.CONTINUED_TYPES;
        if (curType !== prevType && !(ct.has(curType) && ct.has(prevType))) return false;
        if (
            cur.sender.userId !== prev.sender.userId ||
            cur.sender.name !== prev.sender.name ||
            cur.sender.getMxcAvatarUrl() !== prev.sender.getMxcAvatarUrl()
        ) {
            return false;
        }
        return true;
    }

    /**
     * Merge `partial` into the snapshot with a single structured log line
     * naming the trigger (`reason`) and listing the fields that actually
     * changed. No-op merges are skipped entirely.
     *
     * Every snapshot mutation in this class goes through this helper so the
     * console gives a chronological record of view-observable state
     * transitions, attributable to the trigger that caused them. To diagnose
     * a UI jump: filter the console on `[VM-merge]` and find the merge whose
     * field changes line up with the symptom.
     */
    private mergeSnapshot(partial: Partial<TimelineViewSnapshot>, reason: string): void {
        const before = this.snapshot.current;
        const changes: string[] = [];
        for (const [k, v] of Object.entries(partial)) {
            const oldV = (before as unknown as Record<string, unknown>)[k];
            if (Object.is(oldV, v)) continue;
            changes.push(formatSnapshotChange(k, oldV, v));
        }
        if (changes.length === 0) return;
        debug(`[VM-merge] reason=${reason} changes=[${changes.join(", ")}]`);
        this.snapshot.merge(partial);
    }
}

/**
 * Format a single field change for the structured merge log. Arrays show
 * only their length delta; other values show JSON before/after.
 */
function formatSnapshotChange(key: string, oldV: unknown, newV: unknown): string {
    if (Array.isArray(oldV) && Array.isArray(newV)) {
        return `${key}.length: ${oldV.length}→${newV.length}`;
    }
    return `${key}: ${JSON.stringify(oldV)}→${JSON.stringify(newV)}`;
}
