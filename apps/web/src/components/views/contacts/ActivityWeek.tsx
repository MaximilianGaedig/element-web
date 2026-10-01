/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * When a person is usually around, drawn as the hours of a week: a row a weekday, a column an hour, and
 * each cell as strong as the share of such days they were around in it (see utils/contacts/activity).
 *
 * The share is put in five steps rather than drawn as a continuous shade: the question read off it is
 * "is this a good hour to write", and five steps answer that at a glance where forty shades of one
 * colour ask to be compared.
 */

import React, { type JSX } from "react";

import { _t } from "../../../languageHandler";
import { type Week, usualness } from "../../../utils/contacts/activity";

/** 2024-01-01 was a Monday: the row's names come from the reader's own language. */
const dayName = (day: number): string =>
    new Date(Date.UTC(2024, 0, 1 + day)).toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" });

const hourName = (hour: number): string =>
    new Date(Date.UTC(2024, 0, 1, hour)).toLocaleTimeString(undefined, { hour: "numeric", timeZone: "UTC" });

const DAYS = Array.from({ length: 7 }, (_, day) => day);
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/** A share of days as one of five steps, never the lowest for an hour they were seen in at all. */
export function level(share: number): number {
    if (share <= 0) return 0;
    return Math.max(1, Math.min(4, Math.ceil(share * 4)));
}

export function ActivityWeek({ week }: { week: Week }): JSX.Element {
    return (
        <div className="mx_ActivityWeek" role="table">
            <div className="mx_ActivityWeek_hours" aria-hidden>
                {[0, 6, 12, 18].map((hour) => (
                    <span key={hour} style={{ gridColumn: `${hour + 1} / span 6` }}>
                        {hourName(hour)}
                    </span>
                ))}
            </div>
            {DAYS.map((day) => (
                <div key={day} className="mx_ActivityWeek_day" role="row">
                    <span className="mx_ActivityWeek_dayName" role="rowheader">
                        {dayName(day)}
                    </span>
                    <div className="mx_ActivityWeek_cells">
                        {HOURS.map((hour) => (
                            <span
                                key={hour}
                                role="cell"
                                className="mx_ActivityWeek_cell"
                                data-level={level(usualness(week, day, hour))}
                                title={_t("contacts|around_cell", {
                                    day: dayName(day),
                                    hour: hourName(hour),
                                    seen: week.seen[day]?.[hour] ?? 0,
                                    days: week.days[day] ?? 0,
                                })}
                            />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}
