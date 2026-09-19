/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";
import classNames from "classnames";

import { ACTIVITY_FADE_MS } from "../../../utils/beeper/activity";

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
    if (level <= 0) return null;
    if (level >= 1) {
        return <span className={classNames("mx_ActivityDot", className)} role="img" aria-label={label} />;
    }
    return (
        <span className={classNames("mx_ActivityDot mx_ActivityDot_recent", className)} role="img" aria-label={label}>
            {activityMinutes(level)}m
        </span>
    );
}
