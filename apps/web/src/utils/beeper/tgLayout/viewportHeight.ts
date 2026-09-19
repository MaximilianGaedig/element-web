/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Keeps the composer above the on-screen keyboard, ported from Telegram Web K src/index.ts
 * setViewportHeightListeners (GPL-3.0): `--vh` (here `--tg-vh`) is 1% of the visual viewport's
 * height, rounded to 2 decimals, and the app is sized `calc(var(--vh) * 100)`. When the height grows
 * by more than 1vh on a touch device the keyboard was dismissed, so the focused input is blurred
 * (tweb's Android fix). tweb reads the visual viewport ("handle iOS keyboard") in the chat tab.
 */

export const VH_PROPERTY = "--tg-vh";

/** tweb setVH: 1% of `height`, to 2 decimals. */
export function computeVh(height: number): number {
    return +(height * 0.01).toFixed(2);
}

/** Whether a vh change means the on-screen keyboard closed (tweb: touch, grew by more than 1). */
export function keyboardClosed(lastVh: number | undefined, vh: number, isTouch: boolean): boolean {
    return isTouch && lastVh !== undefined && lastVh < vh && vh - lastVh > 1;
}

function isTouchDevice(win: Window): boolean {
    return "ontouchstart" in win || (win.navigator?.maxTouchPoints ?? 0) > 0;
}

/** Starts tracking; returns a function that stops and removes the property. */
export function installViewportHeight(win: Window = window): () => void {
    const viewport: VisualViewport | Window = win.visualViewport ?? win;
    const root = win.document.documentElement;
    const isTouch = isTouchDevice(win);
    let lastVh: number | undefined;

    const setVh = (): void => {
        const height = win.visualViewport?.height ?? win.innerHeight;
        const vh = computeVh(height);
        if (lastVh === vh) return;
        if (keyboardClosed(lastVh, vh, isTouch)) {
            (win.document.activeElement as HTMLElement | null)?.blur?.();
        }
        lastVh = vh;
        root.style.setProperty(VH_PROPERTY, `${vh}px`);
    };

    viewport.addEventListener("resize", setVh);
    setVh();
    return () => {
        viewport.removeEventListener("resize", setVh);
        root.style.removeProperty(VH_PROPERTY);
    };
}
