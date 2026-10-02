/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX } from "react";
import classNames from "classnames";
import { useVirtualizer, type VirtualItem, type Virtualizer } from "@tanstack/react-virtual";
import { InlineSpinner } from "@vector-im/compound-web";

import { useViewModel } from "../../../core/viewmodel/useViewModel";
import type { AnchorAlign, ImmediateScroll, TimelineItem, TimelineViewProps } from "./types";
import { BACKWARD_LOADING_KEY, FORWARD_LOADING_KEY } from "./types";
import { TimelineOverlayButtons } from "./TimelineOverlayButtons";
import { StickyDate, type StickyDateHandle } from "./StickyDate";
import styles from "./TimelineView.module.css";

/**
 * Renders the room timeline: a scrollable list of messages.
 *
 * The list is virtualised — only the rows currently on screen (plus a few just outside it)
 * exist in the DOM, so a room with thousands of messages stays fast. TanStack Virtual does
 * that work; we drive it from `RoomTimelineViewModel`, which supplies the rows to show and
 * is told in return what the user can see.
 *
 * The hard part of a chat timeline is holding the scroll position steady while the list
 * changes underneath the reader. Rows appear at the top when older history loads, get
 * removed when the loaded window is trimmed, and loading spinners come and go. Each of
 * those shifts everything below it, which without care makes the message someone is
 * reading jump away mid-sentence. How each case is handled:
 *
 *  - **Older history arrives at the top.** `anchorTo: "end"` makes TanStack remember which
 *    row the user is looking at and, once the new rows are inserted above it, adjust the
 *    scroll position by the height that was added so that row stays exactly where it was
 *    on screen. It does this before the browser paints, so the shift is never visible.
 *
 *    `isValidAnchorItem` stops it picking a loading spinner as that remembered row: the
 *    spinner is replaced by the messages it was waiting for, so afterwards there is no
 *    such row left to line up against and the timeline would lurch to the top instead.
 *
 *  - **New messages arrive at the bottom.** `followOnAppend` scrolls down to keep them in
 *    view, but only when we are already at the live end and not jumping somewhere else.
 *
 *  - **Reaching either end**, which is the cue to load more, is worked out from which rows
 *    are currently rendered. TanStack has no "you reached the top/bottom" callback.
 *
 *  - **Jumping to a particular message** looks up how far down that message sits and
 *    scrolls straight to that position. We avoid TanStack's `scrollToIndex`, which keeps
 *    steering towards a row *number*: if history loads while it is doing that, every row
 *    shifts down and it follows the wrong one to the top. See `offsetForKey`.
 *
 * `directDomUpdates: true` lets TanStack position rows by writing to the DOM itself rather
 * than going through a React render, so measuring a row and moving it happen in the same
 * frame (splitting them across two caused a visible stutter). React still re-renders when
 * the set of visible rows changes.
 *
 * Known gap: `overscan` counts rows rather than pixels, so how far it actually reaches
 * beyond the viewport varies with how tall those rows happen to be.
 */

/** Seed height for not-yet-measured rows; kept near a typical chat row so the
 * estimate→measured correction stays small. TanStack caches real heights by key thereafter. */
const ESTIMATED_ITEM_HEIGHT = 48;
/** Rows rendered beyond the visible range each side — a COUNT, not px; ~16 ≈ a screenful. */
const OVERSCAN = 16;
/** px from the list bottom still counted as "at the bottom". */
const AT_BOTTOM_THRESHOLD_PX = 4;
/**
 * How long we are willing to keep the timeline hidden on first load, in milliseconds.
 *
 * A spinner covers the list while it scrolls to the message it should start at, because that
 * scroll is neither instant nor nice to watch: rows are still being measured, so the user
 * would see blank white space where messages have not been placed yet, and would watch rows
 * resize as their content finishes arriving — URL previews appearing, polls decrypting. We
 * drop the cover as soon as the target row settles at the position it was aiming for.
 *
 * That content can keep changing height for a while, which shifts the target underneath the
 * scroll, so settling sometimes takes longer than expected — and occasionally never quite
 * completes, for instance when the requested alignment would need more content below it than
 * the room has, and the browser clamps the scroll short of it. This is the point at which we
 * stop waiting and show the timeline anyway: a slightly unsettled timeline beats an endless
 * spinner.
 */
const REVEAL_TIMEOUT_MS = 1000;

/**
 * How long the floating date keeps showing after the last scroll event, in milliseconds.
 *
 * Telegram Web's value: its timeline carries an `is-scrolling` class that it drops 1350ms
 * after scrolling stops, and that class is the only thing that makes the pinned date
 * visible (`components/chat/bubbles.ts`, and the `.is-sticky` opacity rules in
 * `scss/partials/_chat.scss`). So the date appears as soon as the list moves and fades out
 * shortly after it settles, rather than sitting over the messages permanently.
 */
const SCROLL_IDLE_MS = 1350;

/*
 * Revealing a new message, as Telegram Web does it (tweb `helpers/fastSmoothScroll.ts`, called from
 * `renderNewMessage` in `components/chat/bubbles.ts`): the message is added below the visible end and
 * the list scrolls down to it, for a time that grows with the distance, easing out. These are its
 * constants and its two easings; a distance over the long maximum is jumped, and only the rest eased.
 */
const REVEAL_MIN_MS = 250;
const REVEAL_MAX_MS = 600;
const REVEAL_LONG_MAX_DISTANCE = 1500;
const REVEAL_SHORT_MAX_DISTANCE = 500;
const revealShortEasing = (t: number): number => 1 - (1 - t) ** 3.5;
const revealLongEasing = (t: number): number => 1 - (1 - t) ** 5;
/** How long a new row is marked `data-just-added`: past the longer of the two message animations. */
const JUST_ADDED_MS = 400;
/** Whatever the reader does to scroll the list themselves, which takes it back from a reveal. */
const TAKEOVER_EVENTS = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

/**
 * How far the view has got through its first load:
 *  - "init"    — nothing rendered yet; waiting for the first batch of messages.
 *  - "placing" — rows are laid out but still hidden while we scroll to the right spot.
 *  - "live"    — the timeline is visible and the user is in control of scrolling.
 */
/** How long placing the first rows may take before a spinner says something is happening. */
const SPINNER_DELAY_MS = 600;

type Phase = "init" | "placing" | "live";

export function TimelineView({
    vm,
    renderItem,
    renderStickyDate,
    alwaysShowStickyDate = false,
    paddingStart = 0,
    paddingEnd = 0,
    animateNewMessages = false,
    renderPlaceholder,
}: TimelineViewProps): JSX.Element {
    const snapshot = useViewModel(vm);

    // The effects and callbacks below run outside React's render — from scroll events and
    // animation frames — so they cannot use the `snapshot` variable captured when this
    // function last ran, as it may be out of date by then. These refs always hold the
    // latest values for them to read.
    const snapshotRef = useRef(snapshot);
    snapshotRef.current = snapshot;

    // Loading spinners are ordinary entries in this list (kind: "loading") rather than
    // something floating on top of it. That way each spinner occupies real space in the
    // scroll area, so showing or hiding one is just another change to the list that the
    // scroll anchoring described above already knows how to absorb.
    const items = snapshot.items;
    const itemsRef = useRef(items);
    itemsRef.current = items;

    const scrollerRef = useRef<HTMLDivElement | null>(null);

    // On the first load we lay the rows out, scroll to the message we should start at, and
    // only then show the result. Otherwise the user would watch the list shuffle around as
    // rows are measured and the scroll position corrected. A spinner covers the gap. This
    // happens once per room, as the panel is recreated when the room changes.
    const [revealed, setRevealed] = useState(false);
    /*
     * The spinner only once placing takes long enough to notice. Placing is usually a frame or two, and a
     * spinner flashed for that long is what made switching chats feel like loading them; a chat opens
     * blank for that moment instead, the way Telegram's does.
     */
    const [slowToPlace, setSlowToPlace] = useState(false);
    useEffect(() => {
        if (revealed) return;
        const timer = window.setTimeout(() => setSlowToPlace(true), SPINNER_DELAY_MS);
        return () => window.clearTimeout(timer);
    }, [revealed]);
    const revealedRef = useRef(false);

    // ─── The floating date ─────────────────────────────────────────────────────
    // Which day the reader is currently looking at, shown at the top of the list while
    // they scroll, as Telegram, WhatsApp and iMessage all do. Telegram's mechanism, which
    // this follows: the date that has scrolled off the top edge is pinned there
    // (`is-sticky`), and it is only actually shown while the list is moving — see
    // SCROLL_IDLE_MS above and `components/stickyIntersector.ts` for how it decides a
    // date has gone past the edge.
    //
    // `stickyTs` is deliberately never cleared: the label has to stay put while it fades
    // out. `stickyPinned` is the part that goes false once the day's own separator is back
    // on screen, because that separator is then already saying the same thing.
    const stickyDateRef = useRef<StickyDateHandle | null>(null);
    const stickyTsRef = useRef<number | null>(null);
    const stickyPinnedRef = useRef(false);
    const scrollingRef = useRef(false);
    /** How far the next day's date has pushed the pinned one up (tweb: the next group's sticky date). */
    const stickyShiftRef = useRef(0);
    const alwaysShowStickyDateRef = useRef(alwaysShowStickyDate);
    alwaysShowStickyDateRef.current = alwaysShowStickyDate;
    /** Tells the floating date what to show, from whatever last changed. */
    const updateStickyDate = useCallback((): void => {
        stickyDateRef.current?.set(
            stickyTsRef.current,
            stickyPinnedRef.current && (scrollingRef.current || alwaysShowStickyDateRef.current),
            stickyShiftRef.current,
        );
    }, []);

    // Gives each row a stable identity (its event id). TanStack uses these to recognise the
    // same row from one update to the next, which is what makes the scroll anchoring
    // possible at all. It also compares the first row's key between renders to spot when
    // rows have been added or removed at the top, so this must always read the current list.
    const getItemKey = useCallback((index: number): string => items[index]?.key ?? String(index), [items]);

    // Refuses loading spinners as the row the scroll position is anchored to; see the note
    // on `isValidAnchorItem` in the file comment above for why anchoring to one breaks.
    //
    // This tests the row's key rather than its position in the list. When rows are added or
    // removed, TanStack is still working from the positions as they were before the change
    // while `items` already reflects it, so looking a row up by position here would check
    // the wrong one. The spinner keys are shared with the view model, in types.ts.
    const isValidAnchorItem = useCallback(
        (item: VirtualItem): boolean => item.key !== BACKWARD_LOADING_KEY && item.key !== FORWARD_LOADING_KEY,
        [],
    );

    // ─── State used by the scroll reporting below ──────────────────────────────
    const phaseRef = useRef<Phase>("init");
    /** Whether the last scroll left the reader at the end of the list. */
    const atEndRef = useRef(false);
    /** The animation frame of a reveal in progress (see `revealNewMessages`). */
    const revealFrameRef = useRef<number | undefined>(undefined);
    /**
     * Set from the moment new rows are rendered until it is decided whether they are revealed: the
     * virtualizer reports as it measures them, which is before that, and before the list has moved.
     */
    const holdAtBottomRef = useRef(false);
    // We only want to tell the view model about things that have actually changed, so these
    // hold the last values we sent and repeats are skipped.
    const lastVisibleRangeRef = useRef<{ start: number; end: number; readableEnd: number } | null>(null);
    const paddingStartRef = useRef(paddingStart);
    paddingStartRef.current = paddingStart;
    const paddingEndRef = useRef(paddingEnd);
    paddingEndRef.current = paddingEnd;
    const lastAtBottomRef = useRef<boolean | null>(null);
    // For the "reached the top/bottom" reports we remember a short description of the
    // situation we last reported, in the form "<number of rows>:<row index>", and clear it
    // whenever we move away from that end. This stops us reporting over and over while
    // sitting still at the end, while still reporting again once more history has loaded
    // and the user scrolls further into it.
    const startEdgeTokenRef = useRef("");
    const endEdgeTokenRef = useRef("");

    // Tells the view model what the user can currently see: which rows are on screen,
    // whether we are at the bottom, and whether either end of the loaded messages has been
    // reached (the cue for it to load more). TanStack calls this whenever it updates —
    // on scroll, after measuring a row, or when the set of visible rows changes.
    //
    // This only reads state, it never scrolls. It stays quiet until the first load has
    // finished and while we are scrolling to a message the view model asked for, because
    // until then the scroll position reflects our own automatic placement rather than
    // anything the user did.
    const reportVisibleState = useCallback(
        (v: Virtualizer<HTMLDivElement, Element>): void => {
            if (phaseRef.current !== "live" || snapshotRef.current.pendingAnchor !== null) return;
            const itemCount = itemsRef.current.length;
            const visibleRange = v.range;

            // Which rows are on screen, given as positions in the items array; and the last of them
            // whose end is in view, above anything floating over the end of the list.
            if (visibleRange) {
                const top = (v.scrollOffset ?? 0) + paddingStartRef.current;
                const bottom = (v.scrollOffset ?? 0) + (v.scrollRect?.height ?? 0) - paddingEndRef.current;
                let readableEnd = -1;
                for (const row of v.getVirtualItems()) {
                    if (row.end > top && row.end <= bottom + 1 && row.index > readableEnd) readableEnd = row.index;
                }
                if (
                    lastVisibleRangeRef.current?.start !== visibleRange.startIndex ||
                    lastVisibleRangeRef.current?.end !== visibleRange.endIndex ||
                    lastVisibleRangeRef.current?.readableEnd !== readableEnd
                ) {
                    lastVisibleRangeRef.current = {
                        start: visibleRange.startIndex,
                        end: visibleRange.endIndex,
                        readableEnd,
                    };
                    vm.onVisibleRangeChanged(visibleRange.startIndex, visibleRange.endIndex, readableEnd);
                }
            }

            // Are we scrolled to the bottom? Worked out from figures TanStack already holds
            // (how far we have scrolled, the viewport height, the total height) rather than
            // measuring the DOM, which would force the browser to redo layout on every call.
            const scrollOffset = v.scrollOffset ?? 0;
            const viewportHeight = v.scrollRect?.height ?? 0;
            const totalSize = v.getTotalSize();
            // On the way down to a new message we are still following the live end: saying otherwise
            // would flash the "jump to latest" button for the length of the reveal.
            const atBottom =
                revealFrameRef.current !== undefined ||
                holdAtBottomRef.current ||
                (viewportHeight > 0 && scrollOffset + viewportHeight >= totalSize - AT_BOTTOM_THRESHOLD_PX);
            if (atBottom !== lastAtBottomRef.current) {
                lastAtBottomRef.current = atBottom;
                vm.onAtBottomStateChange(atBottom);
            }

            // Which day the topmost visible row belongs to: walk back from it to the
            // separator that introduces that day. Whether to show the date floating is
            // Telegram's test — has that separator itself scrolled above the top edge?
            // While it is still on screen it is already doing the job, and showing the
            // floating copy too would put the same date on screen twice.
            //
            // The edge is where the floating date itself sits, not the top of the list: a header
            // floats over the list, so a separator reaching the list's top has long gone behind it,
            // and handing over only then made the date jump down to where it is pinned. Handed over
            // as the separator reaches the pinned date's place, it simply stays there. And as in
            // Telegram, where each day's date is sticky within its own day, the next day's
            // separator pushes the pinned date up and out rather than replacing it on the spot.
            const startIndex = visibleRange?.startIndex ?? 0;
            const rendered = v.getVirtualItems();
            const box = stickyDateRef.current?.box();
            const edge = scrollOffset + (box?.top ?? 0);
            let pinned = false;
            let next: VirtualItem | undefined;
            let current: VirtualItem | undefined;
            for (const row of rendered) {
                if (itemsRef.current[row.index]?.kind !== "date-separator") continue;
                if (row.start < edge) current = row;
                else if (!next) next = row;
            }
            if (current) {
                const item = itemsRef.current[current.index];
                if (item?.kind === "date-separator") {
                    pinned = true;
                    stickyTsRef.current = item.ts;
                }
            } else {
                // Only rows near the viewport are rendered at all, so a separator that is not
                // among them is far above it and certainly scrolled past.
                for (let i = startIndex; i >= 0; i--) {
                    const item = itemsRef.current[i];
                    if (item?.kind !== "date-separator") continue;
                    pinned = !rendered.some((r) => r.index === i);
                    if (pinned) stickyTsRef.current = item.ts;
                    break;
                }
            }
            stickyShiftRef.current = pinned && next && box ? Math.min(0, next.start - edge - box.height) : 0;
            stickyPinnedRef.current = pinned;
            updateStickyDate();

            // Have we reached either end of the loaded messages? True once the very first or
            // very last row is among those being rendered, which tells the view model it may
            // need to load more history in that direction.
            const renderedItems = v.getVirtualItems();
            const firstRenderedIndex = renderedItems.length ? renderedItems[0].index : -1;
            const lastRenderedIndex = renderedItems.length ? renderedItems[renderedItems.length - 1].index : -1;
            if (firstRenderedIndex === 0) {
                const token = `${itemCount}:${visibleRange ? visibleRange.startIndex : 0}`;
                if (startEdgeTokenRef.current !== token) {
                    startEdgeTokenRef.current = token;
                    vm.onStartReached();
                }
            } else {
                startEdgeTokenRef.current = "";
            }
            if (itemCount > 0 && lastRenderedIndex === itemCount - 1) {
                const token = `${itemCount}:${visibleRange ? visibleRange.endIndex : 0}`;
                if (endEdgeTokenRef.current !== token) {
                    endEdgeTokenRef.current = token;
                    vm.onEndReached();
                }
            } else {
                endEdgeTokenRef.current = "";
            }
        },
        [vm, updateStickyDate],
    );

    // Whether the reader was at the end of the list before this render changed it. It has to be asked
    // before the virtualizer is given the new rows, as it answers for the rows it has; and once per set
    // of rows, as a render may run twice.
    const virtualizerRef = useRef<Virtualizer<HTMLDivElement, Element> | null>(null);
    const atEndBeforeRef = useRef<{ items: TimelineItem[]; atEnd: boolean }>({ items, atEnd: false });
    // The same question for the space kept clear at either end, which changes as what floats there does
    // (a composer growing a line, a reply being quoted above it).
    const clearanceKey = `${paddingStart}:${paddingEnd}`;
    const atEndBeforeClearanceRef = useRef({ key: clearanceKey, atEnd: false });
    if (atEndBeforeClearanceRef.current.key !== clearanceKey) {
        atEndBeforeClearanceRef.current = {
            key: clearanceKey,
            atEnd:
                revealFrameRef.current !== undefined ||
                (virtualizerRef.current?.isAtEnd(AT_BOTTOM_THRESHOLD_PX) ?? false),
        };
    }
    const reducedMotion =
        typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const revealNewMessages = animateNewMessages && !reducedMotion;
    if (atEndBeforeRef.current.items !== items) {
        const atEnd = virtualizerRef.current?.isAtEnd(AT_BOTTOM_THRESHOLD_PX) ?? false;
        atEndBeforeRef.current = { items, atEnd };
        holdAtBottomRef.current = atEnd && revealNewMessages;
    }

    const virtualizer = useVirtualizer({
        count: items.length,
        getScrollElement: () => scrollerRef.current,
        // Only consulted for rows that have not been measured yet. TanStack measures each
        // row as it renders and remembers the result by key, reusing it as rows are added,
        // trimmed or reloaded, so we do not need a size cache of our own.
        estimateSize: () => ESTIMATED_ITEM_HEIGHT,
        getItemKey,
        // Room kept clear for whatever floats over the list; part of its extent, so scrolling to
        // the bottom really reaches the bottom.
        paddingStart,
        paddingEnd,
        overscan: OVERSCAN,
        // Keep whatever the user is looking at visually still when rows are added or
        // removed, correcting the scroll position before the browser paints. This is the
        // main thing stopping the timeline jumping; see the file comment for how it works.
        anchorTo: "end",
        // ...but never hold onto a loading spinner as that reference row (see above). This
        // option comes from our @tanstack/virtual-core patch and is pending upstream.
        isValidAnchorItem,
        // How near the bottom still counts as being at the bottom, for staying put
        // when a message grows. The library's own default of 1px is missed by
        // fractional scroll positions; this is the same tolerance we report with.
        scrollEndThreshold: AT_BOTTOM_THRESHOLD_PX,
        // Scroll down to follow newly arrived messages, but only when we are at the live end
        // of the timeline and are not part-way through jumping somewhere else.
        // When new messages are revealed instead, the list stays where it is as they are added and
        // `revealNewMessages` below does the scrolling.
        followOnAppend: !revealNewMessages && snapshot.atLiveEnd && snapshot.pendingAnchor === null,
        // Let TanStack place rows by writing to the DOM directly instead of re-rendering.
        // Because of this, never set transform or height on a row in JSX below — it would
        // fight with what TanStack writes.
        directDomUpdates: true,
        // Called on every TanStack update; we use it to report what is on screen upwards.
        onChange: reportVisibleState,
    });

    virtualizerRef.current = virtualizer;

    // ─── New messages: added behind the end of the list, then scrolled into view ──
    const stopReveal = useCallback((): void => {
        if (revealFrameRef.current === undefined) return;
        cancelAnimationFrame(revealFrameRef.current);
        revealFrameRef.current = undefined;
    }, []);
    const startReveal = useCallback((): void => {
        const scroller = scrollerRef.current;
        if (!scroller) return;
        stopReveal();
        // A list nobody is looking at (a chat kept open behind another, a hidden tab) has no frames
        // to animate with, and nothing to show: go to the end as the virtualizer would have.
        if (document.hidden || scroller.clientHeight === 0) {
            virtualizerRef.current?.scrollToEnd({ behavior: "auto" });
            return;
        }
        const end = (): number => scroller.scrollHeight - scroller.clientHeight;
        let path = 0;
        let duration = 0;
        let easing = revealShortEasing;
        let startedAt: number | undefined;
        const tick = (now: number): void => {
            if (startedAt === undefined) {
                // Measured a frame after the rows were added, as tweb does, when they have their sizes.
                startedAt = now;
                path = end() - scroller.scrollTop;
                if (path < 1) {
                    revealFrameRef.current = undefined;
                    return;
                }
                if (path > REVEAL_LONG_MAX_DISTANCE) {
                    path = REVEAL_LONG_MAX_DISTANCE;
                    scroller.scrollTop = end() - path;
                }
                duration = REVEAL_MIN_MS + (path / REVEAL_LONG_MAX_DISTANCE) * (REVEAL_MAX_MS - REVEAL_MIN_MS);
                easing = path < REVEAL_SHORT_MAX_DISTANCE ? revealShortEasing : revealLongEasing;
            }
            const t = Math.min((now - startedAt) / duration, 1);
            // From the end as it is now: a row still finding its height moves the end under us.
            scroller.scrollTop = Math.round(end() - path * (1 - easing(t)));
            revealFrameRef.current = t < 1 ? requestAnimationFrame(tick) : undefined;
        };
        revealFrameRef.current = requestAnimationFrame(tick);
    }, [stopReveal]);

    // The reader scrolling takes the list back from a reveal.
    useEffect(() => {
        const scroller = scrollerRef.current;
        if (!scroller) return;
        for (const type of TAKEOVER_EVENTS) scroller.addEventListener(type, stopReveal, { passive: true });
        return () => {
            for (const type of TAKEOVER_EVENTS) scroller.removeEventListener(type, stopReveal);
            stopReveal();
        };
    }, [stopReveal]);

    // ...and when the list itself changes height, which on a phone is the keyboard coming up: the list
    // gets shorter from the bottom, and with nothing moving it the last messages are behind the keyboard.
    // Whether the reader was at the end is what the last scroll left it as, since by the time the size
    // has changed the end is somewhere else. Observers run before the frame is painted, so the list is
    // never seen out of place.
    useEffect(() => {
        const scroller = scrollerRef.current;
        if (!scroller || typeof ResizeObserver === "undefined") return;
        let height = scroller.clientHeight;
        const observer = new ResizeObserver(() => {
            const next = scroller.clientHeight;
            if (next === height) return;
            height = next;
            if (phaseRef.current !== "live" || !atEndRef.current || revealFrameRef.current !== undefined) return;
            if (snapshotRef.current.pendingAnchor !== null || !snapshotRef.current.atLiveEnd) return;
            scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight;
        });
        observer.observe(scroller);
        return () => observer.disconnect();
    }, []);

    // A reader at the end stays at the end when the space kept clear there changes. Nothing else holds
    // them: it is no row changing size, so the virtualizer has no reason to move, and the last message
    // went behind a composer that grew - after which the reader was no longer "at the end" for new
    // messages to be followed either. Declared after the virtualizer, so its new extent is in place.
    useLayoutEffect(() => {
        const scroller = scrollerRef.current;
        if (!scroller || phaseRef.current !== "live" || !atEndBeforeClearanceRef.current.atEnd) return;
        if (snapshotRef.current.pendingAnchor !== null || !snapshotRef.current.atLiveEnd) return;
        // On the way to a new message already: that ends at the end as it now is.
        if (revealFrameRef.current !== undefined) return;
        scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight;
    }, [paddingStart, paddingEnd]);

    const justAddedTimersRef = useRef(new Set<number>());
    useEffect(() => {
        const timers = justAddedTimersRef.current;
        return () => {
            for (const timer of timers) window.clearTimeout(timer);
        };
    }, []);
    const previousItemsRef = useRef(items);
    /** Where the rows added at the end of the list start, if this render added any there to reveal. */
    const addedAtEnd = useCallback((previous: TimelineItem[], next: TimelineItem[]): number | null => {
        if (phaseRef.current !== "live") return null;
        // Rows added after the one that was last: not history loading above, nor a different window.
        const previousLastKey = previous[previous.length - 1]?.key;
        if (previousLastKey === undefined || next.length <= previous.length) return null;
        if (next[next.length - 1].key === previousLastKey) return null;
        let last = next.length - 1;
        while (last >= 0 && next[last].key !== previousLastKey) last--;
        if (last < 0) return null;
        // Only for a reader who is at the live end, or on the way there with the last message.
        const following = atEndBeforeRef.current.atEnd || revealFrameRef.current !== undefined;
        if (!following || !snapshotRef.current.atLiveEnd || snapshotRef.current.pendingAnchor !== null) return null;
        return last + 1;
    }, []);
    useLayoutEffect(() => {
        const previous = previousItemsRef.current;
        previousItemsRef.current = items;
        const held = holdAtBottomRef.current;
        holdAtBottomRef.current = false;
        const from = revealNewMessages && previous !== items ? addedAtEnd(previous, items) : null;
        if (from === null) {
            // Nothing to reveal after all: say where the list really is.
            if (held) reportVisibleState(virtualizer);
            return;
        }

        const added = new Set(items.slice(from).map((item) => item.key));
        const rows: HTMLElement[] = [];
        for (const row of scrollerRef.current?.querySelectorAll<HTMLElement>("li[data-key]") ?? []) {
            if (!added.has(row.dataset.key ?? "")) continue;
            row.dataset.justAdded = "true";
            rows.push(row);
        }
        const timer = window.setTimeout(() => {
            justAddedTimersRef.current.delete(timer);
            for (const row of rows) delete row.dataset.justAdded;
        }, JUST_ADDED_MS);
        justAddedTimersRef.current.add(timer);
        startReveal();
    }, [items, revealNewMessages, startReveal, addedAtEnd, reportVisibleState, virtualizer]);

    // Works out how far down the list we would have to scroll, in pixels, to bring the row
    // with `targetKey` into view — `align` saying whether it should end up at the top,
    // the middle or the bottom of the viewport. Returns null if that message is not among
    // the ones currently loaded, in which case the caller cannot scroll to it yet.
    //
    // Callers hand the result to `scrollToOffset`, which simply scrolls to a fixed pixel
    // position. We deliberately do not use `scrollToIndex`: that keeps steering towards a
    // row *number* as rows are measured, so if older history loads while it is still
    // adjusting, every row shifts down and it follows the wrong one up to the top.
    const offsetForKey = useCallback(
        (targetKey: string | null, align: AnchorAlign): number | null => {
            const idx = targetKey ? itemsRef.current.findIndex((i) => i.key === targetKey) : -1;
            if (idx < 0) return null;
            const info = virtualizer.getOffsetForIndex(idx, align);
            return info ? info[0] : null;
        },
        [virtualizer],
    );
    // ─── First load: scroll to the starting message while hidden, then reveal ──
    // Runs once, as soon as the first batch of messages arrives.
    // Holds the pending animation frame from the settle loop below, so it can be cancelled
    // if the panel goes away while that loop is still running — switching room part-way
    // through the first load, for example. Without this the callback would carry on and
    // update state on a component that no longer exists, and call a disposed view model.
    const coldRafRef = useRef<number | undefined>(undefined);
    useEffect(() => {
        return () => {
            if (coldRafRef.current !== undefined) cancelAnimationFrame(coldRafRef.current);
        };
    }, []);
    useLayoutEffect(() => {
        if (phaseRef.current !== "init" || items.length === 0) return;
        // Move out of "init" immediately, so that if more messages arrive while we are
        // still placing this effect runs again but returns here rather than starting over.
        phaseRef.current = "placing";
        // Start at the message the view model asked for. If it did not ask for one, or that
        // message is not in the batch we were given, start at the newest message instead.
        const anchor = snapshotRef.current.pendingAnchor;
        const list = itemsRef.current;
        let idx = anchor ? list.findIndex((i) => i.key === anchor.targetKey) : -1;
        if (idx < 0) idx = list.length - 1;
        const align: AnchorAlign = anchor?.align ?? "end";
        // Let TanStack carry out this scroll: it keeps correcting the target as rows are
        // measured and their real heights become known. We must not set the scroll position
        // ourselves as well — two things moving the viewport at once end up fighting.
        if (idx >= 0) virtualizer.scrollToIndex(idx, { align, behavior: "auto" });
        // Now watch each frame until that row actually reaches the position it was heading
        // for, and reveal the timeline once it has. requestAnimationFrame passes the frame's
        // timestamp, so we can measure how long we have been waiting in real time and give up
        let startedAt: number | undefined;
        const tick = (now: number): void => {
            startedAt ??= now;
            const info = virtualizer.getOffsetForIndex(idx, align);
            const offset = virtualizer.scrollOffset ?? 0;
            const landed = info !== undefined && Math.abs(info[0] - offset) <= 1.5;
            if (landed || now - startedAt >= REVEAL_TIMEOUT_MS) {
                phaseRef.current = "live";
                if (!revealedRef.current) {
                    revealedRef.current = true;
                    setRevealed(true);
                }
                vm.onAnchorReached();
                return;
            }
            coldRafRef.current = requestAnimationFrame(tick);
        };
        coldRafRef.current = requestAnimationFrame(tick);
    }, [items.length, virtualizer, vm]);

    // Tracks whether the list is moving, which is what decides if the floating date is
    // shown. TanStack has an `isScrolling` of its own, but it drops it 150ms after the
    // last scroll event and that timing is load-bearing for how it measures rows, so this
    // watches the scroll events directly and keeps Telegram's much longer linger instead.
    useEffect(() => {
        const scroller = scrollerRef.current;
        if (!scroller) return;
        let idleTimeout: number | undefined;
        const onScroll = (): void => {
            atEndRef.current =
                scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= AT_BOTTOM_THRESHOLD_PX;
            // Only once the reader is the one scrolling. Placing the timeline scrolls it repeatedly as
            // rows are measured, and reading that as scrolling puts the floating date on screen for the
            // first moment of every room opened - which is the one time nothing has moved.
            if (phaseRef.current === "live") scrollingRef.current = true;
            updateStickyDate();
            window.clearTimeout(idleTimeout);
            idleTimeout = window.setTimeout(() => {
                scrollingRef.current = false;
                updateStickyDate();
            }, SCROLL_IDLE_MS);
        };
        scroller.addEventListener("scroll", onScroll, { passive: true });
        return () => {
            scroller.removeEventListener("scroll", onScroll);
            window.clearTimeout(idleTimeout);
        };
    }, [updateStickyDate]);

    // ─── Later jumps: scroll to a message the view model has asked for ─────────
    // Once the first load is done, the view model can ask us to jump somewhere by setting
    // `pendingAnchor`. This is used by "jump to the latest message" and "jump to the first
    // unread message" when the target was not already loaded, so it had to be fetched and
    // the timeline rebuilt around it first.
    //
    // This effect runs after every render, so it acts as soon as those messages appear, and
    // it scrolls before the browser paints so the jump is never seen as a scrolling motion.
    // `lastPlacedAnchorKeyRef` records which message we last jumped to, so that later
    // renders do not repeat the same jump and fight the user's own scrolling.
    const lastPlacedAnchorKeyRef = useRef<string | null>(null);
    useLayoutEffect(() => {
        if (phaseRef.current !== "live") return;
        const anchor = snapshotRef.current.pendingAnchor;
        if (!anchor) {
            lastPlacedAnchorKeyRef.current = null;
            return;
        }
        if (lastPlacedAnchorKeyRef.current !== anchor.targetKey) {
            const target = offsetForKey(anchor.targetKey, anchor.align);
            if (target !== null) {
                virtualizer.scrollToOffset(target);
                lastPlacedAnchorKeyRef.current = anchor.targetKey;
                vm.onAnchorReached();
            }
        }
    });

    // Handed to the overlay buttons, and through them to the view model, so it can scroll
    // us straight away when the message it wants is already loaded — no fetch needed, and
    // no round trip through `pendingAnchor` above.
    const scrollNow = useCallback<ImmediateScroll>(
        (anchor) => {
            const target = offsetForKey(anchor.targetKey, anchor.align);
            if (target !== null) virtualizer.scrollToOffset(target);
        },
        [offsetForKey, virtualizer],
    );

    const virtualItems = virtualizer.getVirtualItems();

    return (
        <div className={styles.root}>
            <div
                ref={scrollerRef}
                data-testid="timeline-scroller"
                // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
                tabIndex={0}
                className={classNames(styles.scroller, { [styles.hidden]: !revealed })}
            >
                {/* An <ol> of <li> rows, so screen readers announce this as a list of messages
                    and can say how many there are. The role="list" is stated explicitly even
                    though an <ol> already is one: Safari with VoiceOver stops treating a list
                    as a list once list-style is set to none, which our CSS does. The old
                    ScrollPanel does the same thing for the same reason. */}
                {/* eslint-disable jsx-a11y/no-redundant-roles -- see comment above */}
                <ol
                    ref={virtualizer.containerRef}
                    className={classNames("mx_TimelineView_list", styles.list)}
                    role="list"
                >
                    {/* eslint-enable jsx-a11y/no-redundant-roles */}
                    {virtualItems.map((vi) => {
                        const item: TimelineItem | undefined = items[vi.index];
                        if (!item) return null;
                        return (
                            <li
                                key={vi.key}
                                className={classNames("mx_TimelineView_tile", styles.tile)}
                                data-index={vi.index}
                                data-key={item.key}
                                ref={virtualizer.measureElement}
                            >
                                {renderItem(item)}
                            </li>
                        );
                    })}
                </ol>
            </div>
            {!revealed && (
                <div className={styles.cover}>
                    {slowToPlace && (renderPlaceholder ? renderPlaceholder() : <InlineSpinner size={32} />)}
                </div>
            )}
            {renderStickyDate && <StickyDate ref={stickyDateRef} render={renderStickyDate} />}
            {revealed && <TimelineOverlayButtons snapshot={snapshot} vm={vm} scrollNow={scrollNow} />}
        </div>
    );
}
