/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type RefObject, useEffect, useRef, useState } from "react";

/**
 * Whether a `position: sticky` element is currently holding its edge rather than sitting in the flow.
 *
 * CSS has no selector for it - a stuck element looks exactly like an unstuck one - so this watches a
 * zero-height sentinel placed where the sticky element starts. Once the sentinel has scrolled out of
 * the scrolling box, the element is stuck, and the caller can style it differently: Telegram shrinks
 * such a bar and lets what passes behind it blur through.
 *
 * Returns the ref to put on the sentinel, and whether the element is stuck.
 */
export function useStuck<T extends HTMLElement = HTMLDivElement>(): [RefObject<T | null>, boolean] {
    const sentinel = useRef<T>(null);
    const [stuck, setStuck] = useState(false);
    useEffect(() => {
        const el = sentinel.current;
        // Without IntersectionObserver the bar simply never takes its stuck form, which is the
        // ordinary appearance rather than a broken one.
        if (!el || typeof IntersectionObserver === "undefined") return;
        // The panel scrolls, not the page, so the observer has to watch inside whatever box scrolls.
        let root: HTMLElement | null = el.parentElement;
        while (root && !/(auto|scroll)/.test(getComputedStyle(root).overflowY)) root = root.parentElement;
        const observer = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting), {
            root,
            threshold: 0,
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);
    return [sentinel, stuck];
}
