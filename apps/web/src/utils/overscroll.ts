/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/** The three numbers that say where a scroller is, so the rule below can be checked without a DOM. */
export interface ScrollMetrics {
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
}

/**
 * Whether the scroller is past one of its ends, which on a touch screen means a rubber-band bounce
 * is running.
 *
 * Anything that pins the scroller - writing scrollTop to keep the timeline at the bottom - must wait
 * while this is true: writing during the bounce cuts it short and the timeline visibly jumps under
 * the finger. The bounce ends where it started, and the next update pins it as before.
 *
 * Only past an end counts. Resting exactly at either end is the normal case and must not, or the
 * panel would stop pinning itself at the bottom, which is the whole point of it.
 */
export function isOverscrolled({ scrollTop, scrollHeight, clientHeight }: ScrollMetrics): boolean {
    // Clamped at zero: a room holding less than a screenful has a scrollHeight below its clientHeight,
    // so the unclamped bottom is negative and a resting scrollTop of 0 reads as past the end. The panel
    // would then never pin itself in exactly the rooms where there is nothing to scroll.
    return scrollTop < 0 || scrollTop > Math.max(0, scrollHeight - clientHeight);
}
