/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, type ReactNode } from "react";

/** tweb _row.scss .row-grid: icon, title, subtitle. */
export function TgRow({
    icon,
    title,
    subtitle,
    onClick,
    right,
    className,
}: {
    icon?: ReactNode;
    title: ReactNode;
    subtitle?: ReactNode;
    onClick?: () => void;
    right?: ReactNode;
    className?: string;
}): JSX.Element {
    const content = (
        <>
            {icon && <span className="mx_TgRow_icon">{icon}</span>}
            <span className="mx_TgRow_title">{title}</span>
            {subtitle && <span className="mx_TgRow_subtitle">{subtitle}</span>}
            {right && <span className="mx_TgRow_right">{right}</span>}
        </>
    );
    const classes = ["mx_TgRow", subtitle ? "" : "mx_TgRow--noSubtitle", className ?? ""].filter(Boolean).join(" ");
    if (onClick) {
        return (
            <button type="button" className={classes} onClick={onClick}>
                {content}
            </button>
        );
    }
    return <div className={classes}>{content}</div>;
}
