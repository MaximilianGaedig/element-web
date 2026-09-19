/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { _t } from "../../languageHandler";
import { getUserLanguage } from "../../i18n/settings";
import { getTwelveHourOptions } from "../../DateUtils";
import { getUserTimezone } from "../../TimezoneHandler";

/** Presence status_msg prefix the Telegram bridge uses for ghosts' last-seen info. */
const PREFIX = "last seen ";

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
 * Turns a bridged presence into a Telegram-style subtitle: "online", "last seen 5 minutes ago",
 * "last seen recently", ... Returns undefined when there is nothing Telegram-like to show (the
 * status message doesn't start with "last seen " and the user isn't online).
 */
export function formatLastSeen(
    presence: string | undefined,
    statusMsg: string | undefined,
    opts: LastSeenOptions = {},
): string | undefined {
    if (presence === "online") return _t("bridge|last_seen_online");
    if (typeof statusMsg !== "string" || !statusMsg.startsWith(PREFIX)) return undefined;
    const rest = statusMsg.slice(PREFIX.length).trim();
    switch (rest) {
        case "recently":
            return _t("bridge|last_seen_recently");
        case "within a week":
            return _t("bridge|last_seen_within_week");
        case "within a month":
            return _t("bridge|last_seen_within_month");
    }
    // RFC 3339 timestamp; anything else is shown as the bridge sent it.
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(rest)) {
        const ts = Date.parse(rest);
        if (!isNaN(ts)) return formatLastSeenTime(ts, opts);
    }
    return statusMsg;
}

/** True when the bridge only knows a vague last-seen ("recently", "within a week/month"). */
export function isVagueLastSeen(statusMsg: string | undefined): boolean {
    if (typeof statusMsg !== "string" || !statusMsg.startsWith(PREFIX)) return false;
    return ["recently", "within a week", "within a month"].includes(statusMsg.slice(PREFIX.length).trim());
}
