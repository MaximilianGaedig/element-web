/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * The box that actually scrolls `el`, which in a panel is rarely the page.
 *
 * Anything measuring or observing a scroll position needs this: watching the viewport instead gives
 * an element that never appears to move, because the thing moving is a div further up.
 */
export function scrollParentOf(el: HTMLElement | null): HTMLElement | null {
    let parent = el?.parentElement ?? null;
    while (parent && !/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) parent = parent.parentElement;
    return parent;
}
