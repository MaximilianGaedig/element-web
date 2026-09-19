/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The edge swipe that goes back from a chat to the chat list, with Telegram Web K's gesture rules
 * (GPL-3.0):
 *   src/helpers/dom/isSwipingBackSafari.ts   a back swipe starts within 30px of the left edge
 *   src/helpers/dom/handleHorizontalSwipe.ts vertical travel > 20px before the swipe turns horizontal
 *                                            cancels it; once |x| > |y| the swipe locks horizontal
 *   src/helpers/dom/handleTabSwipe.ts        past 50px of horizontal travel the swipe navigates
 */

import { SWIPE_BACK_EDGE, SWIPE_COMMIT_THRESHOLD, SWIPE_VERTICAL_CANCEL } from "./constants";

export type SwipePhase = "pending" | "horizontal" | "cancelled" | "committed";

export interface SwipeBackState {
    startX: number;
    startY: number;
    phase: SwipePhase;
    /** Horizontal travel so far (positive = towards the right, i.e. back). */
    dx: number;
}

/** A swipe begins only for a touch starting at the left edge (isSwipingBackSafari). */
export function beginSwipeBack(x: number, y: number): SwipeBackState | null {
    if (x >= SWIPE_BACK_EDGE) return null;
    return { startX: x, startY: y, phase: "pending", dx: 0 };
}

/** handleHorizontalSwipe onSwipe + handleTabSwipe onSwipe for one move to (x, y). */
export function moveSwipeBack(state: SwipeBackState, x: number, y: number): SwipeBackState {
    if (state.phase === "cancelled" || state.phase === "committed") return state;
    const xDiff = x - state.startX;
    const yDiff = y - state.startY;
    let phase: SwipePhase = state.phase;

    if (phase !== "horizontal" && Math.abs(yDiff) > SWIPE_VERTICAL_CANCEL) {
        return { ...state, phase: "cancelled", dx: 0 };
    }

    if (Math.abs(xDiff) > Math.abs(yDiff)) {
        phase = "horizontal";
    } else if (phase !== "horizontal" && Math.abs(yDiff) > Math.abs(xDiff)) {
        return { ...state, phase: "cancelled", dx: 0 };
    }

    // handleTabSwipe: only travel towards "back" counts, and past the threshold it navigates.
    const dx = Math.max(0, xDiff);
    if (phase === "horizontal" && Math.abs(xDiff) > SWIPE_COMMIT_THRESHOLD && xDiff > 0) {
        return { ...state, phase: "committed", dx };
    }
    return { ...state, phase, dx };
}

/** Whether the move should stop the page from scrolling (tweb cancels the event once horizontal). */
export function shouldPreventScroll(state: SwipeBackState): boolean {
    return state.phase === "horizontal" || state.phase === "committed";
}
