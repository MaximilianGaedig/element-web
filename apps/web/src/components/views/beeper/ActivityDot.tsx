/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";
import classNames from "classnames";

interface Props {
    /** 0–1 from activityLevel(): 1 = online, fading towards 0 after the user was last active. */
    level: number;
    className?: string;
    label?: string;
}

/**
 * Presence dot like Telegram Web K's online badge: shown only for online or recently active users, pops
 * in with tweb's badge transition, and fades with the time since the user was last active.
 */
export function ActivityDot({ level, className, label }: Props): JSX.Element | null {
    if (level <= 0) return null;
    return (
        <span
            className={classNames("mx_ActivityDot", className)}
            style={{ "--mx-activity": level.toFixed(3) } as React.CSSProperties}
            role="img"
            aria-label={label}
        />
    );
}
