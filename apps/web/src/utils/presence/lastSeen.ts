/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { _t } from "../../languageHandler";
import { getUserLanguage } from "../../i18n/settings";
import { getTwelveHourOptions } from "../../DateUtils";
import { getUserTimezone } from "../../TimezoneHandler";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Calendar day key (YYYY-MM-DD) of a timestamp in the user's timezone. */
function dayKey(ts: number, timeZone: string | undefined): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(ts);
}

export interface LastSeenOptions {
    now?: number;
    showTwelveHour?: boolean;
    locale?: string;
    timeZone?: string;
}

/**
 * Formats an exact time the way Telegram does ("last seen 5 minutes ago", "last seen yesterday at 13:06"),
 * both for the network's own last-seen time and for activity we observed ourselves (their last message
 * or read receipt).
 */
export function formatLastSeenTime(ts: number, opts: LastSeenOptions = {}): string {
    const now = opts.now ?? Date.now();
    const locale = opts.locale ?? getUserLanguage();
    const timeZone = opts.timeZone ?? getUserTimezone();
    const diff = now - ts;
    if (diff < MINUTE) return _t("bridge|last_seen_just_now");
    if (diff < HOUR) return _t("bridge|last_seen_minutes_ago", { count: Math.floor(diff / MINUTE) });

    const date = new Date(ts);
    const at = new Intl.DateTimeFormat(locale, {
        ...getTwelveHourOptions(opts.showTwelveHour ?? false),
        hour: "numeric",
        minute: "2-digit",
        timeZone,
    }).format(date);

    const day = dayKey(ts, timeZone);
    if (day === dayKey(now, timeZone)) return _t("bridge|last_seen_today_at", { time: at });
    if (day === dayKey(now - 24 * HOUR, timeZone)) return _t("bridge|last_seen_yesterday_at", { time: at });
    const sameYear = day.slice(0, 4) === dayKey(now, timeZone).slice(0, 4);
    const dateStr = new Intl.DateTimeFormat(locale, {
        timeZone,
        day: "numeric",
        month: "short",
        year: sameYear ? undefined : "numeric",
    }).format(date);
    return _t("bridge|last_seen_date_at", { date: dateStr, time: at });
}

/**
 * The Telegram-style subtitle for a user's presence: "online", or "last seen 5 minutes ago" from the
 * homeserver's last-active time (which the bridges keep accurate). Undefined when neither is known.
 */
export function formatPresence(
    online: boolean,
    lastActive: number | undefined,
    opts: LastSeenOptions = {},
): string | undefined {
    if (online) return _t("bridge|last_seen_online");
    if (lastActive === undefined) return undefined;
    return formatLastSeenTime(lastActive, opts);
}
