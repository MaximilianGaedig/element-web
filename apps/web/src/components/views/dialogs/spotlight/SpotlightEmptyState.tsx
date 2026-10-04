/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, type ReactNode } from "react";
import classNames from "classnames";

interface Props {
    /** A 24px Compound icon, shown in a tinted circle above the title. */
    icon: ReactNode;
    title: string;
    /** What to try next. */
    description?: string;
    className?: string;
}

/** The middle of the search view when there is nothing to list: an icon, what happened and what to try. */
export function SpotlightEmptyState({ icon, title, description, className }: Props): JSX.Element {
    return (
        <div className={classNames("mx_SpotlightDialog_emptyState", className)}>
            <span className="mx_SpotlightDialog_emptyState_icon" aria-hidden>
                {icon}
            </span>
            <span className="mx_SpotlightDialog_emptyState_title">{title}</span>
            {description && <span className="mx_SpotlightDialog_emptyState_description">{description}</span>}
        </div>
    );
}
