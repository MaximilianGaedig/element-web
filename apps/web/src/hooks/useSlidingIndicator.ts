/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { useCallback, useLayoutEffect, useRef, useState } from "react";

/**
 * A filled shape that slides to whichever item is selected.
 *
 * The same movement the shared media strip has (see _SharedMedia.pcss `mx_SharedMedia_tabBackground`): one
 * absolutely positioned element behind the row, moved by transform and resized to the selected item, so
 * the selection travels instead of blinking from one place to another. Measured from the items themselves
 * rather than computed from their count, because they are not all the same width.
 *
 * Returns a ref-setter to put on each item, and the style for the sliding shape - which is undefined until
 * something has been measured, so nothing is drawn in the wrong place on the first paint.
 */
export function useSlidingIndicator<K extends string>(
    active: K,
): {
    itemRef: (key: K) => (el: HTMLElement | null) => void;
    style: { transform: string; width: number } | undefined;
} {
    const items = useRef(new Map<K, HTMLElement>());
    const [style, setStyle] = useState<{ transform: string; width: number }>();

    useLayoutEffect(() => {
        const el = items.current.get(active);
        if (!el) return;
        setStyle({ transform: `translateX(${el.offsetLeft}px)`, width: el.offsetWidth });
    }, [active]);

    const itemRef = useCallback(
        (key: K) => (el: HTMLElement | null) => {
            if (el) items.current.set(key, el);
            else items.current.delete(key);
        },
        [],
    );

    return { itemRef, style };
}
