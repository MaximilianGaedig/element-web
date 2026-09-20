/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Swipe a message to the left to reply to it, as in Telegram (Web K src/components/chat/bubbles.ts
 * swipe-to-reply, GPL-3.0; iOS the same): the message follows the finger with some resistance, a round
 * reply glyph grows out of the edge behind it, the phone ticks when the swipe is far enough to count, and
 * letting go past that point replies while the message springs back.
 *
 * The message is moved by an inline transform rather than a class: React owns the tile's className and
 * rewrites it whenever the tile re-renders (a new message arriving, a receipt, a decryption), which would
 * drop the class mid-gesture. React leaves inline styles it doesn't set alone.
 *
 * It coexists with vertical scrolling (the swipe only locks once the touch is clearly horizontal), with
 * the swipe that goes back to the chat list (which travels the other way), and with anything inside a
 * message that scrolls sideways itself - a wide code block or table keeps its own drag.
 */

import { haptic } from "../../haptics";
import { TG_ICON_PATHS } from "../../../components/views/telegram/tgIconPaths";
import { SWIPE_VERTICAL_CANCEL } from "./constants";
import { swipeBlockedAt } from "./swipeBack";

/** How far (px) the message must be pulled for the release to reply. */
export const SWIPE_REPLY_THRESHOLD = 64;
/** The farthest the message travels (px); beyond the threshold the finger meets growing resistance. */
const SWIPE_REPLY_MAX = 96;
/** Horizontal travel before the touch is taken as a swipe rather than a tap or a scroll. */
const LOCK_DISTANCE = 10;
/** How long the message takes to spring back. */
const RETURN_MS = 220;

/** The distance the message has moved for a finger travel of `dx` (positive): 1:1 up to the threshold, then eased. */
export function swipeTravel(dx: number): number {
    if (dx <= SWIPE_REPLY_THRESHOLD) return dx;
    const over = dx - SWIPE_REPLY_THRESHOLD;
    const room = SWIPE_REPLY_MAX - SWIPE_REPLY_THRESHOLD;
    return SWIPE_REPLY_THRESHOLD + room * (1 - Math.exp(-over / room));
}

function makeGlyph(): HTMLElement {
    const glyph = document.createElement("div");
    glyph.className = "mx_TgSwipeReply";
    glyph.setAttribute("aria-hidden", "true");
    glyph.innerHTML = `<svg viewBox="${TG_ICON_PATHS.reply.viewBox}"><path d="${TG_ICON_PATHS.reply.d}"/></svg>`;
    return glyph;
}

/**
 * Makes `element` swipeable to the left; `onReply` runs when a swipe is released past the threshold.
 * `canStart` may refuse a touch (while editing, in a chat one can't post to, and so on). Returns a
 * function that removes the gesture.
 */
export function attachSwipeReply(
    element: HTMLElement,
    onReply: () => void,
    canStart: (target: Element | null) => boolean = () => true,
): () => void {
    let startX = 0;
    let startY = 0;
    let phase: "idle" | "pending" | "swiping" | "cancelled" = "idle";
    let armed = false;
    let glyph: HTMLElement | undefined;
    let returning: number | undefined;

    const show = (travel: number): void => {
        element.style.transform = travel ? `translateX(${-travel}px)` : "";
        glyph?.style.setProperty("--tg-swipe-progress", String(Math.min(1, travel / SWIPE_REPLY_THRESHOLD)));
    };

    /** Puts the message and the glyph back exactly as they were, now or after the spring back. */
    const clear = (animate: boolean): void => {
        const done = glyph;
        glyph = undefined;
        if (returning !== undefined) window.clearTimeout(returning);
        returning = undefined;
        if (!animate) {
            done?.remove();
            element.style.transform = "";
            element.style.transition = "";
            element.style.willChange = "";
            return;
        }
        element.style.transition = `transform ${RETURN_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`;
        element.style.transform = "";
        returning = window.setTimeout(() => {
            returning = undefined;
            done?.remove();
            element.style.transition = "";
            element.style.willChange = "";
        }, RETURN_MS);
    };

    /** Ends whatever gesture is in progress; `commit` sends the reply. */
    const finish = (commit: boolean): void => {
        const swiping = phase === "swiping";
        phase = "idle";
        armed = false;
        if (!swiping) return;
        clear(true);
        if (commit) onReply();
    };

    const onStart = (e: TouchEvent): void => {
        // A finger landing while a swipe is running (a second finger, or a new touch during the spring
        // back) ends that one first, so nothing is left translated or with a glyph on it.
        if (phase === "swiping") finish(false);
        if (returning !== undefined) clear(false);
        if (
            e.touches.length !== 1 ||
            !canStart(e.target as Element | null) ||
            swipeBlockedAt(e.target as Element, element)
        ) {
            phase = "cancelled";
            return;
        }
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        phase = "pending";
        armed = false;
    };

    const onMove = (e: TouchEvent): void => {
        if (phase === "idle" || phase === "cancelled") return;
        if (e.touches.length !== 1) {
            finish(false);
            phase = "cancelled";
            return;
        }
        const dx = startX - e.touches[0].clientX; // positive = leftwards
        const dy = e.touches[0].clientY - startY;
        if (phase === "pending") {
            if (Math.abs(dy) > SWIPE_VERTICAL_CANCEL && Math.abs(dy) > Math.abs(dx)) {
                phase = "cancelled";
                return;
            }
            if (dx < LOCK_DISTANCE || dx < Math.abs(dy) * 1.5) return;
            phase = "swiping";
            glyph = makeGlyph();
            element.appendChild(glyph);
            element.style.transition = "";
            element.style.willChange = "transform";
        }
        // A swipe that has turned horizontal must not also scroll the timeline.
        if (e.cancelable) e.preventDefault();
        const travel = swipeTravel(Math.max(0, dx));
        show(travel);
        const past = dx >= SWIPE_REPLY_THRESHOLD;
        if (past && !armed) haptic("light");
        armed = past;
    };

    const onEnd = (): void => finish(armed);
    const onCancel = (): void => finish(false);

    element.addEventListener("touchstart", onStart, { passive: true });
    element.addEventListener("touchmove", onMove, { passive: false });
    element.addEventListener("touchend", onEnd);
    element.addEventListener("touchcancel", onCancel);
    return (): void => {
        element.removeEventListener("touchstart", onStart);
        element.removeEventListener("touchmove", onMove);
        element.removeEventListener("touchend", onEnd);
        element.removeEventListener("touchcancel", onCancel);
        phase = "idle";
        clear(false);
    };
}
