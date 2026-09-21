/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The layout keeps a few facts on <html> - which screen tier is in use, which bubble tail, whether the
 * glass is on - because overlays rendered outside the tree (dialogs, menus) have to follow them too.
 *
 * Setting one on mount and removing it on unmount looks obvious and is wrong: React mounts the next
 * instance before unmounting the last, so the dying one removes the attribute the living one just set,
 * and every rule written for it stops matching until something re-renders. A tier lost that way takes
 * the whole handheld layout with it. Counting holders means the attribute lives until the last one
 * lets go.
 */

import { useEffect } from "react";

const holders = new Map<string, number>();

/** Holds `name` at `value` (or held absent, for `undefined`) until the returned function is called. */
export function holdDocumentAttribute(name: string, value: string | undefined): () => void {
    const root = document.documentElement;
    holders.set(name, (holders.get(name) ?? 0) + 1);
    if (value === undefined) root.removeAttribute(name);
    else root.setAttribute(name, value);

    let released = false;
    return () => {
        if (released) return;
        released = true;
        const left = (holders.get(name) ?? 1) - 1;
        if (left > 0) {
            holders.set(name, left);
            return;
        }
        holders.delete(name);
        root.removeAttribute(name);
    };
}

/** [holdDocumentAttribute] for as long as the component is mounted. */
export function useDocumentAttribute(name: string, value: string | undefined): void {
    useEffect(() => holdDocumentAttribute(name, value), [name, value]);
}
