/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import classNames from "classnames";

import styles from "./TimelineView.module.css";

/**
 * What the timeline holds onto to drive the floating date.
 *
 * It is driven imperatively, and lives in its own component, because it changes while the
 * reader scrolls: doing that through the timeline's own state would re-render the whole
 * virtualised list mid-scroll, competing with TanStack's direct DOM writes for the same
 * frame. Only this one label re-renders now.
 */
export interface StickyDateHandle {
    /**
     * @param ts the day being read, or null when there is none to name yet
     * @param visible whether it should be on screen at all
     * @param shift how far the next day's date has pushed it up, in pixels (0 or less)
     */
    set(ts: number | null, visible: boolean, shift?: number): void;
    /** Where the date sits over the list and how tall it is, once it is drawn. */
    box(): { top: number; height: number } | null;
}

interface StickyDateProps {
    /** Draws the label for a given day. */
    render: (ts: number) => ReactNode;
}

export const StickyDate = forwardRef<StickyDateHandle, StickyDateProps>(function StickyDate({ render }, ref) {
    // The day is kept even once it should be hidden, so the label stays put as it fades out.
    const [state, setState] = useState<{ ts: number | null; visible: boolean; shift: number }>({
        ts: null,
        visible: false,
        shift: 0,
    });
    const element = useRef<HTMLDivElement>(null);
    const box = useRef<{ top: number; height: number } | null>(null);

    // Keep layout reads out of the virtualizer's scroll callback. That callback can run
    // several times per frame; offsetTop/offsetHeight there forced a synchronous layout
    // for every update. Measure when the label or its surrounding layout changes instead.
    useLayoutEffect(() => {
        const el = element.current;
        if (!el) return;

        const measureTop = (): void => {
            const top = Number.parseFloat(getComputedStyle(el).top);
            box.current = { top: Number.isFinite(top) ? top : 0, height: box.current?.height ?? el.offsetHeight };
        };
        measureTop();

        const resizeObserver = new ResizeObserver(([entry]) => {
            if (!entry) return;
            const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
            const top = box.current?.top ?? 0;
            box.current = { top, height };
        });
        resizeObserver.observe(el);

        // Telegram's floating header updates the inherited top inset on an ancestor style
        // when its measured height changes. That need not resize this absolutely positioned
        // label, so watch the short ancestor chain for those infrequent layout updates.
        const mutationObserver = new MutationObserver(measureTop);
        for (let node: Element | null = el; node; node = node.parentElement) {
            mutationObserver.observe(node, { attributes: true, attributeFilter: ["style"] });
        }
        window.addEventListener("resize", measureTop);

        return () => {
            resizeObserver.disconnect();
            mutationObserver.disconnect();
            window.removeEventListener("resize", measureTop);
        };
    }, [state.ts]);

    useImperativeHandle(
        ref,
        () => ({
            set(ts, visible, shift = 0) {
                setState((prev) => {
                    const nextTs = ts ?? prev.ts;
                    if (prev.ts === nextTs && prev.visible === visible && prev.shift === shift) return prev;
                    return { ts: nextTs, visible, shift };
                });
            },
            box() {
                return box.current;
            },
        }),
        [],
    );

    if (state.ts === null) return null;
    return (
        <div
            ref={element}
            className={classNames(styles.stickyDate, { [styles.stickyDateVisible]: state.visible })}
            style={state.shift ? { transform: `translateY(${state.shift}px)` } : undefined}
            // A copy of a date the list already states in place, shown for as long as the
            // reader is moving through it. Announcing it again on every scroll would be
            // noise, and nothing in it can be interacted with.
            aria-hidden="true"
        >
            {render(state.ts)}
        </div>
    );
});
