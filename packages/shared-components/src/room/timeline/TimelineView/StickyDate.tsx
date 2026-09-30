/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { forwardRef, useImperativeHandle, useRef, useState, type ReactNode } from "react";
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
                const el = element.current;
                return el ? { top: el.offsetTop, height: el.offsetHeight } : null;
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
