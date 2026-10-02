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
/** How far the visual viewport is panned down from the top of the page (iOS pans it to reveal the focused input). */
export const VIEWPORT_TOP_PROPERTY = "--tg-vv-top";
/** Set on <html> while the on-screen keyboard is up (it then covers the home-indicator inset). */
export const KEYBOARD_ATTRIBUTE = "data-tg-keyboard";
/** How much shorter than the layout viewport the visual one must be to count as the keyboard. */
const KEYBOARD_MIN_PX = 120;
/** The most the installed app's heights are ever reported short by: a status bar, with room to spare. */
const SHORTFALL_MAX_PX = 64;

/** tweb setVH: 1% of `height`, to 2 decimals. */
export function computeVh(height: number): number {
    return +(height * 0.01).toFixed(2);
}

/** Whether a vh change means the on-screen keyboard closed (tweb: touch, grew by more than 1). */
export function keyboardClosed(lastVh: number | undefined, vh: number, isTouch: boolean): boolean {
    return isTouch && lastVh !== undefined && lastVh < vh && vh - lastVh > 1;
}

/** Whether the app is running installed to the home screen, with the whole screen and no browser toolbars. */
function isInstalled(win: Window): boolean {
    return (
        !!win.matchMedia?.("(display-mode: standalone)").matches ||
        (win.navigator as Navigator & { standalone?: boolean })?.standalone === true
    );
}

/**
 * Makes the page as tall as the screen in the installed app, and returns what undoes it.
 *
 * Installed on an iPhone, iOS reports the viewport a status bar short (768 of 812 on an iPhone 11 Pro)
 * while drawing the page from under the status bar, so a page as tall as the viewport stops that far
 * above the bottom of the screen. Once the page itself is taller, iOS reports the viewport at the full
 * height too. Measured on the device: that only happens when the height is on the root element itself -
 * the same height from a stylesheet leaves iOS on the short viewport - which is why this is done here
 * and not in the styles. In a browser tab the large viewport is the screen with the toolbars away,
 * which is not what the page has, so a tab is left alone.
 */
function fillInstalledScreen(win: Window): () => void {
    const root = win.document.documentElement;
    if (!isInstalled(win) || !isTouchDevice(win)) return () => {};
    const height = root.style.getPropertyValue("height");
    const priority = root.style.getPropertyPriority("height");
    root.style.setProperty("height", "100lvh", "important");
    return () => root.style.setProperty("height", height, priority);
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
    const installed = isTouch && isInstalled(win);
    let restingShortfall = 0;

    /*
     * How far short of the screen a height iOS reports is, in the installed app. The page there is as tall
     * as the screen (fillInstalledScreen), so the root element is the screen's height whatever iOS says
     * the viewport is. Only a status bar's worth counts: more than that is something else being measured.
     */
    const shortOfScreen = (reported: number): number => {
        const shortfall = root.getBoundingClientRect().height - reported;
        return shortfall > 0 && shortfall <= SHORTFALL_MAX_PX ? shortfall : 0;
    };

    const setVh = (): void => {
        const visual = win.visualViewport?.height ?? win.innerHeight;
        const keyboard = isTouch && win.innerHeight - visual > KEYBOARD_MIN_PX;
        /*
         * Installed on an iPhone, iOS draws the page from under the status bar and can still report its
         * heights a status bar short (see fillInstalledScreen). With the keyboard down that does not matter,
         * the app being sized by the screen; with it up the app is as tall as the visual viewport, and one
         * reported short leaves the composer that far above the keyboard. So what the heights are short by
         * is given back: as seen with the keyboard down, or in the layout viewport now.
         */
        let height = visual;
        if (installed) {
            if (keyboard) height += Math.max(restingShortfall, shortOfScreen(win.innerHeight));
            else restingShortfall = shortOfScreen(visual);
        }
        root.toggleAttribute(KEYBOARD_ATTRIBUTE, keyboard);
        // iOS pans the visual viewport up to keep the focused input in view (the page itself doesn't resize),
        // so the app, which is as tall as the visual viewport, has to follow it or it ends up below the
        // visible part, with the composer under the keyboard. While the keyboard is down there is no pan.
        if (keyboard) {
            if (win.scrollY !== 0) win.scrollTo(0, 0);
            root.style.setProperty(VIEWPORT_TOP_PROPERTY, `${Math.max(0, win.visualViewport?.offsetTop ?? 0)}px`);
        } else {
            root.style.removeProperty(VIEWPORT_TOP_PROPERTY);
        }
        const vh = computeVh(height);
        if (lastVh === vh) return;
        if (keyboardClosed(lastVh, vh, isTouch)) {
            (win.document.activeElement as HTMLElement | null)?.blur?.();
        }
        lastVh = vh;
        root.style.setProperty(VH_PROPERTY, `${vh}px`);
    };

    const unfill = fillInstalledScreen(win);
    viewport.addEventListener("resize", setVh);
    // The pan changes without the size changing.
    if (win.visualViewport) win.visualViewport.addEventListener("scroll", setVh);
    setVh();
    return () => {
        viewport.removeEventListener("resize", setVh);
        win.visualViewport?.removeEventListener("scroll", setVh);
        unfill();
        root.style.removeProperty(VH_PROPERTY);
        root.style.removeProperty(VIEWPORT_TOP_PROPERTY);
        root.removeAttribute(KEYBOARD_ATTRIBUTE);
    };
}
