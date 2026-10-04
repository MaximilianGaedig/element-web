/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useLayoutEffect, useRef, useState } from "react";
import classNames from "classnames";

import { scrollStripTo } from "../../../utils/scrollStripTo";

/** One tab of a {@link PillTabs} strip. */
export interface PillTab<T> {
    /** What the tab stands for; compared with `===` to find the active one. */
    value: T;
    label: string;
}

interface Props<T> {
    "tabs": PillTab<T>[];
    "active": T;
    "onChange"(this: void, value: T): void;
    /** Names the strip for assistive technology. */
    "aria-label": string;
    "className"?: string;
}

/**
 * A row of tabs with a filled pill that slides under the active one, as Telegram Web K's
 * `.menu-horizontal-div` (src/scss/partials/_slider.scss) and the shared-media panel's tabs do. The strip
 * scrolls sideways when the tabs do not fit, and keeps the active one in view.
 */
export function PillTabs<T>({ tabs, active, onChange, className, ...rest }: Props<T>): JSX.Element {
    const strip = useRef<HTMLDivElement>(null);
    const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
    const activeIndex = tabs.findIndex((tab) => tab.value === active);

    useLayoutEffect(() => {
        const el = strip.current?.querySelectorAll<HTMLElement>(".mx_PillTabs_tab")[activeIndex];
        if (!el || !strip.current) {
            setPill(null);
            return;
        }
        setPill({ left: el.offsetLeft, width: el.offsetWidth });
        scrollStripTo(strip.current, el, "center");
        // The labels decide the widths, so a change of label (language, tab set) moves the pill too.
    }, [activeIndex, tabs]);

    // The WAI-ARIA tabs pattern: the arrows, Home and End move between the tabs and choose the one they land on.
    const onKeyDown = (ev: React.KeyboardEvent): void => {
        let next: number;
        switch (ev.key) {
            case "ArrowLeft":
                next = (activeIndex - 1 + tabs.length) % tabs.length;
                break;
            case "ArrowRight":
                next = (activeIndex + 1) % tabs.length;
                break;
            case "Home":
                next = 0;
                break;
            case "End":
                next = tabs.length - 1;
                break;
            default:
                return;
        }
        ev.preventDefault();
        ev.stopPropagation();
        onChange(tabs[next].value);
        strip.current?.querySelectorAll<HTMLElement>(".mx_PillTabs_tab")[next]?.focus();
    };

    return (
        <div
            ref={strip}
            className={classNames("mx_PillTabs", className)}
            role="tablist"
            aria-label={rest["aria-label"]}
        >
            {pill && (
                <span
                    className="mx_PillTabs_pill"
                    style={{ transform: `translateX(${pill.left}px)`, width: pill.width }}
                    aria-hidden
                />
            )}
            {tabs.map((tab, i) => (
                <button
                    key={tab.label}
                    type="button"
                    role="tab"
                    aria-selected={i === activeIndex}
                    // One stop in the Tab order for the whole strip; the arrows move inside it.
                    tabIndex={i === activeIndex ? 0 : -1}
                    className={classNames("mx_PillTabs_tab", { mx_PillTabs_tab_active: i === activeIndex })}
                    onClick={() => onChange(tab.value)}
                    onKeyDown={onKeyDown}
                >
                    {tab.label}
                </button>
            ))}
        </div>
    );
}
