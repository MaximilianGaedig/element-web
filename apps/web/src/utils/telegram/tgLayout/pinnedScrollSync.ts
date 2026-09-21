/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The pinned plate follows the timeline, as Telegram Web K's does (GPL-3.0,
 * src/components/chat/pinnedMessage.tsx `setCorrectIndex`/`testMid`): it takes the bottom-most message
 * on screen and shows the newest pin at or before it, throttled to 100ms. Scrolling back through a chat
 * therefore walks the plate back through its pins, instead of leaving it on the newest one.
 *
 * tweb compares message ids, which increase with time on a Telegram chat. Matrix has no such number, so
 * the comparison is by timestamp, which is what the ids stand for there; the pinned list is already
 * sorted oldest first.
 */

/** tweb's throttle on the scroll handler. */
const SYNC_THROTTLE_MS = 100;

/** The timestamp of the lowest message tile that is still on screen, or undefined if there is none. */
export function bottomVisibleTimestamp(
    scroller: HTMLElement,
    timestampOf: (eventId: string) => number | undefined,
): number | undefined {
    const bottom = scroller.getBoundingClientRect().bottom;
    const tiles = scroller.querySelectorAll<HTMLElement>("[data-event-id]");
    for (let i = tiles.length - 1; i >= 0; i--) {
        const tile = tiles[i];
        // The lowest tile whose top has been reached: anything below it is still under the composer.
        if (tile.getBoundingClientRect().top < bottom) {
            const ts = timestampOf(tile.dataset.eventId!);
            if (ts !== undefined) return ts;
        }
    }
    return undefined;
}

/**
 * Which pin belongs to a message sent at `ts`: the newest one at or before it, and the oldest pin for
 * anything older than all of them, so scrolling to the top of a chat shows the first pin rather than none.
 */
export function pinnedIndexForTimestamp(pinnedTimestamps: number[], ts: number): number {
    let index = 0;
    for (let i = 0; i < pinnedTimestamps.length; i++) {
        if (pinnedTimestamps[i] <= ts) index = i;
    }
    return index;
}

/**
 * Keeps `onIndex` in step with the timeline under `scroller`. Returns a function that stops it.
 *
 * `isFollowing` tells it to stand back: clicking the plate jumps through the pins itself, and tweb locks
 * the sync while that runs so the scroll it causes cannot fight the click.
 */
export function syncPinnedToScroll(
    scroller: HTMLElement,
    timestampOf: (eventId: string) => number | undefined,
    pinnedTimestamps: () => number[],
    onIndex: (index: number) => void,
    isFollowing: () => boolean,
): () => void {
    let timer: number | undefined;
    let last: number | undefined;

    const sync = (): void => {
        timer = undefined;
        if (isFollowing()) return;
        const timestamps = pinnedTimestamps();
        if (timestamps.length < 2) return;
        const ts = bottomVisibleTimestamp(scroller, timestampOf);
        if (ts === undefined) return;
        const index = pinnedIndexForTimestamp(timestamps, ts);
        if (index === last) return;
        last = index;
        onIndex(index);
    };

    const onScroll = (): void => {
        if (timer === undefined) timer = window.setTimeout(sync, SYNC_THROTTLE_MS);
    };

    scroller.addEventListener("scroll", onScroll, { passive: true });
    sync();
    return () => {
        scroller.removeEventListener("scroll", onScroll);
        if (timer !== undefined) window.clearTimeout(timer);
    };
}
