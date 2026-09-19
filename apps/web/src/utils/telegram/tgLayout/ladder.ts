/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The "ladder" in which a freshly opened chat's messages appear, ported from Telegram Web K
 * src/components/chat/bubbles.ts animateAsLadder (GPL-3.0): starting from the newest bubble, each one
 * zooms in from scale(.8) and fades in (src/scss/partials/_chatBubble.scss .can-zoom-fade.zoom-fade,
 * --bubble-transition-in: .3s cubic-bezier(.4, 0, .2, 1)), each 40ms after the one below it. tweb does
 * this on the first render of a chat's history; it has no animation for later inserts or removals.
 */

/** bubbles.ts animateAsLadder: `delay` for a first render. */
export const LADDER_DELAY_MS = 40;
/** bubbles.ts animateAsLadder TRANSITION_TIME (= --bubble-transition-in). */
export const LADDER_TRANSITION_MS = 300;
/** --transition-standard-easing. */
export const LADDER_EASING = "cubic-bezier(.4, 0, .2, 1)";

/**
 * Delays for `count` bubbles ordered newest first: the target (newest) bubble goes at
 * (0 || 0.1) × delay, the older ones at (idx + offsetIndex) × delay with offsetIndex 1.
 */
export function ladderDelays(count: number): number[] {
    const delays: number[] = [];
    for (let i = 0; i < count; ++i) delays.push(i === 0 ? 0.1 * LADDER_DELAY_MS : i * LADDER_DELAY_MS);
    return delays;
}

const KEYFRAMES: Keyframe[] = [
    { transform: "scale3d(.8, .8, 1)", opacity: 0 },
    { transform: "scale3d(1, 1, 1)", opacity: 1 },
];

/**
 * Plays the ladder on the event tiles of `messageList` that are inside `viewport` (what the user sees),
 * using the Web Animations API so React's own class and style updates on the tiles are left alone.
 * Returns how many bubbles were animated.
 */
export function playLadder(messageList: Element, viewport: DOMRect): number {
    const tiles = Array.from(messageList.querySelectorAll<HTMLElement>('[data-testid="event-tile"]'));
    const visible = tiles
        .filter((tile) => {
            const rect = tile.getBoundingClientRect();
            return rect.bottom > viewport.top && rect.top < viewport.bottom;
        })
        .reverse();
    const delays = ladderDelays(visible.length);
    let animated = 0;
    visible.forEach((tile, i) => {
        const bubble = tile.querySelector<HTMLElement>('[data-testid="event-tile-line"]') ?? tile;
        if (typeof bubble.animate !== "function") return;
        bubble.animate(KEYFRAMES, {
            duration: LADDER_TRANSITION_MS,
            easing: LADDER_EASING,
            delay: delays[i],
            fill: "backwards",
        });
        animated++;
    });
    return animated;
}
