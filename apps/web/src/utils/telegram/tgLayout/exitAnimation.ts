/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Letting something finish leaving before it is unmounted.
 *
 * Overlays here animate in and then vanish, because React removes them the moment they are closed and
 * CSS has nothing left to animate. This marks the node as closing, waits for whatever animation that
 * starts, and only then lets the caller unmount it.
 *
 * It decides nothing itself: a node with no closing animation defined for it resolves immediately, so
 * this is inert wherever the stylesheet says nothing, and no caller needs to know which layout is on.
 */

/** Set on the node while it plays its exit; the stylesheet hangs the animation off it. */
export const CLOSING_ATTRIBUTE = "data-tg-closing";

/**
 * How long an exit may take before it is abandoned. An overlay that cannot finish animating must still
 * close: a stuck menu is far worse than one that disappears without ceremony.
 */
const MAX_EXIT_MS = 400;

const wait = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

/**
 * Plays `node`'s exit animation, if it has one.
 *
 * Returns nothing at all when there is nothing to wait for, rather than a promise that resolves later:
 * a close with no animation must still happen in the same tick, which is what every caller and every
 * test of them expects.
 */
export function playExit(node: HTMLElement | null | undefined): Promise<unknown> | undefined {
    if (!node?.isConnected || typeof node.getAnimations !== "function") return;
    node.setAttribute(CLOSING_ATTRIBUTE, "true");
    // getAnimations flushes pending style, so the animation the attribute starts is already here.
    const animations = node.getAnimations({ subtree: true }).map((animation) => animation.finished);
    if (!animations.length) {
        node.removeAttribute(CLOSING_ATTRIBUTE);
        return;
    }
    return Promise.race([Promise.allSettled(animations), wait(MAX_EXIT_MS)]);
}
