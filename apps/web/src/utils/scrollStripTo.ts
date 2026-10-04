/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/** Scrolls a horizontal strip (only) so `item` is in view: at the nearest edge, or centred. */
export function scrollStripTo(strip: HTMLElement, item: HTMLElement, mode: "nearest" | "center"): void {
    const left = item.offsetLeft - strip.offsetLeft;
    const right = left + item.offsetWidth;
    let target = strip.scrollLeft;
    if (mode === "center") target = left - (strip.clientWidth - item.offsetWidth) / 2;
    else if (left < strip.scrollLeft) target = left;
    else if (right > strip.scrollLeft + strip.clientWidth) target = right - strip.clientWidth;
    strip.scrollTo({ left: target, behavior: "smooth" });
}
