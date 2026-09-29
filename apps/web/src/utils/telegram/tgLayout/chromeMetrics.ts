/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The measurements the floating chrome writes into custom properties that pad the message list.
 *
 * Writing one moves every message in the timeline, so when it happens matters as much as what it says:
 * a change of a third of a pixel, which a rect produces constantly and the header produces on its own
 * as a chat's status line reflows, would shift the list under a finger that is scrolling it.
 */

/**
 * Writes `px` to the custom property `name` on `el`, rounded, and only when that changes it.
 *
 * Both halves matter. Rounding stops a rect's fractional part from counting as a change; comparing
 * against what is already there stops an observation that measured the same thing twice from writing
 * at all. Returns whether it wrote, which is what the tests hang on.
 */
export function setChromeMetric(el: HTMLElement, name: string, px: number): boolean {
    const value = `${Math.round(px)}px`;
    if (el.style.getPropertyValue(name) === value) return false;
    el.style.setProperty(name, value);
    return true;
}
