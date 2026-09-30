/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Going back by dragging, on the gesture this client already has.
 *
 * The rules live in utils/telegram/tgLayout/swipeBack.ts and are the ones the chat columns use: a swipe
 * starts anywhere rather than at an edge, more than 20px of vertical travel first cancels it, it locks
 * horizontal once |x| beats |y|, and it commits past 50px. `swipeBlockedAt` keeps it off the things that
 * want a horizontal drag of their own - text fields, sliders, anything scrolled sideways.
 *
 * This is the hook shape of that, for the layers in the contacts column. Writing a second gesture with its
 * own thresholds would have meant two back-swipes in one app that felt subtly different.
 */

import { type RefObject, useEffect } from "react";

import {
    type SwipeBackState,
    beginSwipeBack,
    moveSwipeBack,
    shouldPreventScroll,
    swipeBlockedAt,
} from "../utils/telegram/tgLayout/swipeBack";
import { cancelContextMenuOpening } from "../utils/telegram/tgLayout/longPress";
import { haptic } from "../utils/haptics";

/** Calls `onBack` when a swipe on the element commits. Touch only, which is the only place it means anything. */
export function useSwipeBack(ref: RefObject<HTMLElement | null>, onBack: () => void, enabled = true): void {
    useEffect(() => {
        const element = ref.current;
        if (!element || !enabled) return;
        let swipe: SwipeBackState | null = null;

        const onTouchStart = (event: TouchEvent): void => {
            swipe =
                event.touches.length === 1 && !swipeBlockedAt(event.target as Element | null, element)
                    ? beginSwipeBack(event.touches[0].clientX, event.touches[0].clientY)
                    : null;
        };
        const onTouchMove = (event: TouchEvent): void => {
            if (!swipe) return;
            swipe = moveSwipeBack(swipe, event.touches[0].clientX, event.touches[0].clientY);
            if (swipe.phase === "cancelled") {
                swipe = null;
                return;
            }
            if (shouldPreventScroll(swipe)) {
                if (event.cancelable) event.preventDefault();
                // A finger that turned out to be swiping is not a finger holding a row down.
                cancelContextMenuOpening();
            }
            if (swipe.phase === "committed") {
                swipe = null;
                haptic("light");
                onBack();
            }
        };
        const onTouchEnd = (): void => {
            swipe = null;
        };

        element.addEventListener("touchstart", onTouchStart, { passive: true });
        // Non-passive: the scroll underneath has to be stoppable once the swipe locks horizontal.
        element.addEventListener("touchmove", onTouchMove, { passive: false });
        element.addEventListener("touchend", onTouchEnd);
        element.addEventListener("touchcancel", onTouchEnd);
        return () => {
            element.removeEventListener("touchstart", onTouchStart);
            element.removeEventListener("touchmove", onTouchMove);
            element.removeEventListener("touchend", onTouchEnd);
            element.removeEventListener("touchcancel", onTouchEnd);
        };
    }, [ref, onBack, enabled]);
}
