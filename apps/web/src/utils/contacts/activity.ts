/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * When a person is usually around: the hours of their week, from the homeserver's activity log.
 *
 * Presence says where somebody is now and forgets it at the next change. Where the homeserver keeps a
 * log of it (tuwunel's `im.mxg.activity`: presence changes, what they sent, typing, read receipts), it
 * answers the other question - when is it worth writing to them - as a grid of weekday by hour: on how
 * many days they were around in that hour, out of how many such days the log covers.
 *
 * A person is every account they have, and each account has a log of its own; they are around when any
 * of their accounts is, so the grids are laid over each other.
 */

import { type MatrixClient, Method } from "matrix-js-sdk/src/matrix";

import { type Person } from "./people";

const ACTIVITY_FEATURE = "im.mxg.activity";
const ACTIVITY_PREFIX = "/_matrix/client/unstable/im.mxg.activity";

/** How far back "usually" looks: habits change, and a year-old one says little about this week. */
const WEEKS = 12;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** The hours of a week: rows are weekdays from Monday, columns the hours of the day. */
export interface Week {
    /** On how many different days they were around in each hour. */
    seen: number[][];
    /** How long they were online in each hour, in milliseconds, over all those days. */
    onlineMs: number[][];
    /** How many of each weekday the log covers: what `seen` is out of. */
    days: number[];
    /** How many rows of the log this was read from. */
    entries: number;
}

interface WireWeek {
    seen: number[][];
    online_ms: number[][];
    days: number[];
    entries: number;
}

const grid = (fill: (day: number, hour: number) => number): number[][] =>
    Array.from({ length: 7 }, (_, day) => Array.from({ length: 24 }, (_, hour) => fill(day, hour)));

/**
 * Several accounts' weeks as one person's: around in an hour when any account was.
 *
 * The days two accounts were seen on cannot be told apart from their counts, so an hour takes the most
 * any one account says - never more days than there were - and the time online is added up.
 */
export function mergeWeeks(weeks: readonly Week[]): Week | undefined {
    if (!weeks.length) return undefined;
    return {
        seen: grid((day, hour) => Math.max(...weeks.map((week) => week.seen[day]?.[hour] ?? 0))),
        onlineMs: grid((day, hour) => weeks.reduce((sum, week) => sum + (week.onlineMs[day]?.[hour] ?? 0), 0)),
        days: Array.from({ length: 7 }, (_, day) => Math.max(...weeks.map((week) => week.days[day] ?? 0))),
        entries: weeks.reduce((sum, week) => sum + week.entries, 0),
    };
}

/** How usual an hour is, from never (0) to every such day (1). */
export function usualness(week: Week, day: number, hour: number): number {
    const days = week.days[day] ?? 0;
    if (!days) return 0;
    return Math.min(1, (week.seen[day]?.[hour] ?? 0) / days);
}

/** Whether the log holds enough to call anything usual: a grid drawn from three rows says nothing. */
export function saysSomething(week: Week | undefined): week is Week {
    return !!week && week.entries >= 10 && week.seen.some((day) => day.some((count) => count > 0));
}

async function weekOf(client: MatrixClient, mxid: string, fromTs: number): Promise<Week | undefined> {
    const res = await client.http.authedRequest<{ week?: WireWeek }>(
        Method.Get,
        `/users/${encodeURIComponent(mxid)}`,
        {
            week: "true",
            from_ts: String(fromTs),
            // The reader's hours, not UTC's: "evenings" has to mean their evenings.
            utc_offset_minutes: String(-new Date().getTimezoneOffset()),
        },
        undefined,
        { prefix: ACTIVITY_PREFIX },
    );
    const week = res.week;
    if (!week) return undefined;
    return { seen: week.seen, onlineMs: week.online_ms, days: week.days, entries: week.entries };
}

/**
 * The person's week over the last few months, or undefined where the homeserver keeps no log or holds
 * too little about them to say.
 */
export async function personWeek(client: MatrixClient, person: Person, now = Date.now()): Promise<Week | undefined> {
    try {
        if (!(await client.doesServerSupportUnstableFeature(ACTIVITY_FEATURE))) return undefined;
        const mxids = person.accounts.map((account) => account.mxid).filter((mxid): mxid is string => !!mxid);
        const weeks = await Promise.all(
            // One account that cannot be read (no room shared with it any more) does not hide the others.
            mxids.map((mxid) => weekOf(client, mxid, now - WEEKS * WEEK_MS).catch(() => undefined)),
        );
        const merged = mergeWeeks(weeks.filter((week): week is Week => !!week));
        return saysSomething(merged) ? merged : undefined;
    } catch {
        return undefined;
    }
}
