/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The pinned-message plate's pure logic, ported from Telegram Web K (GPL-3.0):
 *   src/components/chat/pinnedMessageBorder.ts  (itself after telegram-react's PinnedMessageBorder.js)
 *                                                 the segmented bar and its moving mark
 *   src/components/animatedSuper.ts              which side rows slide in from / out to
 *   src/components/chat/pinnedMessage.tsx        index conventions and the click-to-follow cycle
 *
 * tweb counts pins newest-first (pinnedIndex 0 = newest); Element's banner counts oldest-first
 * (currentEventIndex count - 1 = newest). The helpers below take tweb's pinnedIndex.
 */

/** tweb's `enum BAR_HEIGHTS` (FOUR and MORE share 10px, so a const object here). */
const BAR_HEIGHTS = {
    ONE: 40,
    TWO: 19,
    THREE: 12,
    FOUR: 10,
    MORE: 10,
} as const;

const GAP = 2;
export const BORDER_WIDTH = 3;
const RADIUS = 1.5;

/** Element's oldest-first index ⇄ tweb's newest-first pinnedIndex. */
export function toPinnedIndex(count: number, currentEventIndex: number): number {
    return count - 1 - currentEventIndex;
}

/** pinnedMessageBorder.ts getBarHeight (== getMarkHeight). */
export function getBarHeight(count: number): number {
    if (count <= 1) return BAR_HEIGHTS.ONE;
    if (count === 2) return BAR_HEIGHTS.TWO;
    if (count === 3) return BAR_HEIGHTS.THREE;
    if (count === 4) return BAR_HEIGHTS.FOUR;
    return BAR_HEIGHTS.MORE;
}

/** pinnedMessageBorder.ts getMarkTranslateY. */
export function getMarkTranslateY(index: number, barHeight: number, count: number): number {
    if (count === 1) return 0;
    if (count === 2) return !index ? 0 : barHeight + GAP;
    if (count === 3) {
        if (!index) return 0;
        if (index === 1) return barHeight + GAP;
        return barHeight * 2 + GAP * 2 + 1;
    }
    return (barHeight + GAP) * index;
}

/** pinnedMessageBorder.ts getTrackHeight. */
export function getTrackHeight(count: number, barHeight: number): number {
    return count <= 3 ? BAR_HEIGHTS.ONE : barHeight * count + GAP * (count - 1);
}

/** pinnedMessageBorder.ts getTrackTranslateY: scrolls long tracks so the mark stays in view. */
export function getTrackTranslateY(index: number, count: number, barHeight: number, trackHeight: number): number {
    if (count <= 3) return 0;
    if (index <= 1) return 0;
    if (index >= count - 2) return trackHeight - BAR_HEIGHTS.ONE;
    return (index - 2) * barHeight + index * GAP;
}

function drawRect(x: number, y: number, width: number, height: number, radius: number): string {
    return `M${x},${y + radius}a${radius},${radius},0,0,1,${width},0v${height - 2 * radius}a${radius},${radius},0,0,1,${-width},0Z`;
}

/** pinnedMessageBorder.ts getClipPath: the SVG path cutting the track into bars. */
export function getClipPathD(barHeight: number, count: number): string {
    if (count === 2) {
        return (
            drawRect(0, 0, BORDER_WIDTH, barHeight, RADIUS) +
            drawRect(0, barHeight + GAP * 2, BORDER_WIDTH, barHeight, RADIUS)
        );
    }
    let d = "";
    for (let i = 0; i < count; ++i) d += drawRect(0, (barHeight + GAP) * i, BORDER_WIDTH, barHeight, RADIUS);
    return d;
}

export interface BorderGeometry {
    barHeight: number;
    markHeight: number;
    trackHeight: number;
    markTranslateY: number;
    trackTranslateY: number;
    clipPathD: string;
    /** Fade masks at the ends of a scrolled track (more than 4 pins). */
    mask: boolean;
    maskTop: boolean;
    maskBottom: boolean;
}

/** pinnedMessageBorder.ts render(count, index), where `index` counts oldest-first (tweb passes count - pinnedIndex - 1). */
export function borderGeometry(count: number, index: number): BorderGeometry {
    const barHeight = getBarHeight(count);
    const trackHeight = getTrackHeight(count, barHeight);
    let maskTop: boolean;
    let maskBottom: boolean;
    if (index <= 1) {
        maskTop = false;
        maskBottom = true;
    } else if (index >= count - 2) {
        maskTop = true;
        maskBottom = false;
    } else {
        maskTop = maskBottom = true;
    }
    return {
        barHeight,
        markHeight: barHeight,
        trackHeight,
        markTranslateY: getMarkTranslateY(index, barHeight, count),
        trackTranslateY: getTrackTranslateY(index, count, barHeight, trackHeight),
        clipPathD: getClipPathD(barHeight, count),
        mask: count > 4,
        maskTop,
        maskBottom,
    };
}

export type SuperSide = "from-top" | "from-bottom";

/**
 * animatedSuper.ts animate(index, previousIndex): the incoming row starts on `enter` and slides to
 * rest, the outgoing row slides away to `leave`. Moving to an older pin (a higher pinnedIndex) comes
 * from the top.
 */
export function superSides(index: number, previousIndex: number): { enter: SuperSide; leave: SuperSide } {
    const fromTop = index > previousIndex;
    return fromTop ? { enter: "from-top", leave: "from-bottom" } : { enter: "from-bottom", leave: "from-top" };
}

/** pinnedMessage.tsx followPinnedMessage: after jumping, show the next older pin, wrapping to the newest. */
export function nextPinnedIndexAfterFollow(pinnedIndex: number, count: number): number {
    return pinnedIndex >= count - 1 ? 0 : pinnedIndex + 1;
}

/** pinnedMessage.tsx: the "#N" counter (N = count - pinnedIndex), hidden on the newest pin. */
export function pinnedCounter(pinnedIndex: number, count: number): { value: number; isLast: boolean } {
    return { value: count - pinnedIndex, isLast: pinnedIndex === 0 };
}
