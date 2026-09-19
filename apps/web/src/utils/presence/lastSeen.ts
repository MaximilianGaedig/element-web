/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { _t } from "../../languageHandler";
import { getUserLanguage } from "../../i18n/settings";
import { getTwelveHourOptions } from "../../DateUtils";
import { getUserTimezone } from "../../TimezoneHandler";
import { type PresenceInfo } from "./activity";
import { presenceNow } from "./clock";

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
 * The Telegram-style subtitle for a user's presence, from the same {@link PresenceInfo} the avatar tag
 * uses: "online", "last seen 5 minutes ago" (the tag's minutes), then "today at 13:06" and so on.
 * Undefined when nothing is known.
 */
export function formatPresence(info: PresenceInfo | undefined, opts: LastSeenOptions = {}): string | undefined {
    if (!info) return undefined;
    if (info.online) return _t("bridge|last_seen_online");
    const { lastActive, minutes } = info;
    if (lastActive === undefined || minutes === undefined) return undefined;
    if (minutes < 1) return _t("bridge|last_seen_just_now");
    if (minutes < 60) return _t("bridge|last_seen_minutes_ago", { count: minutes });

    const now = opts.now ?? presenceNow();
    const locale = opts.locale ?? getUserLanguage();
    const timeZone = opts.timeZone ?? getUserTimezone();
    const date = new Date(lastActive);
    const at = new Intl.DateTimeFormat(locale, {
        ...getTwelveHourOptions(opts.showTwelveHour ?? false),
        hour: "numeric",
        minute: "2-digit",
        timeZone,
    }).format(date);

    const day = dayKey(lastActive, timeZone);
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
