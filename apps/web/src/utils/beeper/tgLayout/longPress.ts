/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Long-press opens the message context menu, ported from Telegram Web K
 * src/helpers/dom/attachContextMenuListener.ts (GPL-3.0). Browsers that fire `contextmenu` on a touch
 * hold (Android) already reach Element's menus; on Apple touch devices, which never fire it, a single
 * finger held for 400ms without moving opens the menu, and the touchend that follows is swallowed so
 * the menu does not close instantly. A swipe in progress cancels the pending menu
 * (cancelContextMenuOpening, 400ms).
 */

import { LONG_PRESS_MS } from "./constants";

let cancelOpening = false;
let cancelOpeningTimeout: number | undefined;

/** tweb cancelContextMenuOpening: suppress a pending long-press for the next 400ms. */
export function cancelContextMenuOpening(): void {
    if (cancelOpeningTimeout) window.clearTimeout(cancelOpeningTimeout);
    cancelOpeningTimeout = window.setTimeout(() => {
        cancelOpeningTimeout = undefined;
        cancelOpening = false;
    }, LONG_PRESS_MS);
    cancelOpening = true;
}

/** tweb IS_APPLE && IS_TOUCH_SUPPORTED: where a touch hold never produces `contextmenu`. */
export function needsLongPressEmulation(nav: Navigator = navigator, win: Window = window): boolean {
    const isApple = /Mac|iPhone|iPad|iPod/.test(nav.platform ?? "") || /iPhone|iPad|iPod|Macintosh/.test(nav.userAgent);
    const isTouch = "ontouchstart" in win || (nav.maxTouchPoints ?? 0) > 0;
    return isApple && isTouch;
}

/**
 * Listen for long-presses under `element`; each one dispatches a `contextmenu` MouseEvent at the touch
 * point on the touched element, which React's onContextMenu handlers (message tiles) receive.
 */
export function attachLongPressContextMenu(element: HTMLElement): () => void {
    let timeout: number | undefined;
    const options: AddEventListenerOptions = { capture: true };

    const onCancel = (): void => {
        window.clearTimeout(timeout);
        element.removeEventListener("touchmove", onCancel, options);
        element.removeEventListener("touchend", onCancel, options);
        element.removeEventListener("touchcancel", onCancel, options);
    };

    const swallow = (e: Event): void => {
        e.preventDefault();
        e.stopPropagation();
    };

    const onTouchStart = (e: TouchEvent): void => {
        if (e.touches.length > 1) {
            onCancel();
            return;
        }
        const touch = e.touches[0];
        const target = e.target as Element | null;

        element.addEventListener("touchmove", onCancel, options);
        element.addEventListener("touchend", onCancel, options);
        element.addEventListener("touchcancel", onCancel, options);

        timeout = window.setTimeout(() => {
            onCancel();
            if (cancelOpening || !target) return;
            const menuEvent = new MouseEvent("contextmenu", {
                bubbles: true,
                cancelable: true,
                clientX: touch.clientX,
                clientY: touch.clientY,
                screenX: touch.screenX,
                screenY: touch.screenY,
            });
            target.dispatchEvent(menuEvent);
            // "fix instant closing": the finger lifting must not click the freshly opened menu away.
            if (menuEvent.defaultPrevented) element.addEventListener("touchend", swallow, { once: true });
        }, LONG_PRESS_MS);
    };

    element.addEventListener("touchstart", onTouchStart, { passive: true });
    return () => {
        onCancel();
        element.removeEventListener("touchstart", onTouchStart);
        element.removeEventListener("touchend", swallow);
    };
}
