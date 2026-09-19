/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useLayoutEffect, useRef } from "react";
import classNames from "classnames";

import { ACTIVITY_FADE_MS } from "../../../utils/presence/activity";

interface Props {
    /** 0–1 from activityLevel(): 1 = online, falling towards 0 over the hour after the user was last active. */
    level: number;
    className?: string;
    label?: string;
}

/** Minutes since the user was last active, from an activity level (which fades over ACTIVITY_FADE_MS). */
export function activityMinutes(level: number): number {
    return Math.max(1, Math.round(((1 - level) * ACTIVITY_FADE_MS) / 60000));
}

/**
 * Presence badge, the way Messenger and Facebook show it: a green dot while the user is online, and
 * for someone who was active within the last hour a small green "12m" tag instead. Pops in with
 * Telegram Web K's badge transition.
 */
export function ActivityDot({ level, className, label }: Props): JSX.Element | null {
    const tag = useRef<HTMLSpanElement>(null);
    const recent = level > 0 && level < 1;
    // The avatar's cut-out around the tag follows its size, which changes with the text ("1m" vs "59m"):
    // publish it on the avatar view for the mask (_ActivityDot.pcss). Layout sizes, so the pop-in
    // transform doesn't disturb them.
    useLayoutEffect(() => {
        const el = tag.current;
        const host = el?.parentElement;
        if (!recent || !el || !host) return;
        const update = (): void => {
            host.style.setProperty("--PresenceTag-width", `${el.offsetWidth}px`);
            host.style.setProperty("--PresenceTag-height", `${el.offsetHeight}px`);
        };
        update();
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(update);
        observer.observe(el);
        return () => {
            observer.disconnect();
            host.style.removeProperty("--PresenceTag-width");
            host.style.removeProperty("--PresenceTag-height");
        };
    }, [recent]);

    if (level <= 0) return null;
    if (level >= 1) {
        return <span className={classNames("mx_ActivityDot", className)} role="img" aria-label={label} />;
    }
    return (
        <span
            ref={tag}
            className={classNames("mx_ActivityDot mx_ActivityDot_recent", className)}
            role="img"
            aria-label={label}
        >
            {activityMinutes(level)}m
        </span>
    );
}
