/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Haptic feedback where Telegram iOS gives it (reactions, selection, the long-press menu, swipe-back).
 *
 * Android and other browsers with the Vibration API get navigator.vibrate(). iOS Safari has none, but
 * since iOS 18 toggling an <input type="checkbox" switch> plays the system switch haptic, and clicking a
 * <label> for it counts - the trick from ios-vibrator-pro-max (github.com/samdenty/ios-vibrator-pro-max,
 * ISC). We only take that one trick: the library also wraps the whole <body> in a label and redefines
 * document.body, which would break every React portal here. Since iOS 18.4 the switch only ticks within
 * ~1s of a tap (click/touchend), so on iOS haptics fired from a tap work, and ones fired mid-gesture (a
 * long-press timer, a drag crossing a threshold) are silently skipped.
 */

export type HapticKind = "selection" | "light" | "medium" | "heavy" | "success" | "warning" | "error";

/** Vibration API patterns (ms), after Telegram Android's HapticFeedbackConstants usage. */
const VIBRATE: Record<HapticKind, number | number[]> = {
    selection: 5,
    light: 10,
    medium: 20,
    heavy: 35,
    success: [10, 60, 20],
    warning: [20, 80, 20],
    error: [20, 50, 20, 50, 20],
};

/** Switch ticks per kind (iOS has one haptic; several in a row read as the notification kinds). */
const TICKS: Record<HapticKind, number> = {
    selection: 1,
    light: 1,
    medium: 1,
    heavy: 1,
    success: 2,
    warning: 2,
    error: 3,
};
/** ios-vibrator-pro-max's spacing between switch ticks. */
const TICK_SPACING_MS = 27;

let trigger: HTMLLabelElement | null | undefined;

/** Apple touch devices (iOS/iPadOS Safari and home-screen apps), where the switch trick applies. */
function isAppleTouch(): boolean {
    const nav = navigator;
    return /iPhone|iPad|iPod/.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1);
}

/** The hidden switch and its label, created on first use outside the React root. */
function getTrigger(): HTMLLabelElement | null {
    if (trigger !== undefined) return trigger;
    if (typeof document === "undefined" || !isAppleTouch()) return (trigger = null);
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    input.tabIndex = -1;
    input.setAttribute("aria-hidden", "true");
    input.style.setProperty("display", "none", "important");
    label.tabIndex = -1;
    label.setAttribute("aria-hidden", "true");
    // Rendered but empty and out of the way (only the input is display:none, as in the library, so the
    // label's activation still toggles it).
    label.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;overflow:hidden;pointer-events:none";
    label.appendChild(input);
    // Clicks on the label are ours; keep them from reaching the app's click handlers.
    label.addEventListener("click", (e) => e.stopPropagation());
    document.body.appendChild(label);
    return (trigger = label);
}

/** Plays a haptic, if the device can. Call it from the tap (click/touchend) handler that causes it. */
export function haptic(kind: HapticKind = "light"): void {
    try {
        if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
            navigator.vibrate(VIBRATE[kind]);
            return;
        }
        const label = getTrigger();
        if (!label) return;
        label.click();
        for (let i = 1; i < TICKS[kind]; i++) window.setTimeout(() => label.click(), i * TICK_SPACING_MS);
    } catch {
        // Haptics are a nicety; never let them break the action that triggered them.
    }
}
