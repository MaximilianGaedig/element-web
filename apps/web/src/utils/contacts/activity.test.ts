/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect } from "vitest";

import { type Week, mergeWeeks, personWeek, saysSomething, usualness } from "./activity";
import { type Person } from "./people";
import { stubClient } from "test-utils";

const empty = (): number[][] => Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));

function week(cells: [day: number, hour: number, seen: number][], days = 4, entries = 50): Week {
    const seen = empty();
    for (const [day, hour, count] of cells) seen[day][hour] = count;
    return { seen, onlineMs: empty(), days: Array.from({ length: 7 }, () => days), entries };
}

const wire = (w: Week): object => ({ week: { seen: w.seen, online_ms: w.onlineMs, days: w.days, entries: w.entries } });

function person(...mxids: string[]): Person {
    return { id: mxids[0], name: "Richard", accounts: mxids.map((mxid) => ({ mxid })) } as unknown as Person;
}

describe("a person's week", () => {
    it("says how usual an hour is out of the days the log covers", () => {
        const w = week([[0, 9, 3]]);
        expect(usualness(w, 0, 9)).toBe(0.75);
        expect(usualness(w, 0, 10)).toBe(0);
        // A weekday the log doesn't reach yet is not "never": it is unknown, and drawn as nothing.
        expect(usualness({ ...w, days: [0, 4, 4, 4, 4, 4, 4] }, 0, 9)).toBe(0);
    });

    it("lays a person's accounts over each other", () => {
        const merged = mergeWeeks([
            week([[0, 9, 3]]),
            week([
                [0, 9, 1],
                [5, 22, 2],
            ]),
        ])!;
        // Never more days than one account saw: the same Monday on two networks is one Monday.
        expect(merged.seen[0][9]).toBe(3);
        expect(merged.seen[5][22]).toBe(2);
        expect(merged.entries).toBe(100);
    });

    it("says nothing from a log too short to say it", () => {
        expect(saysSomething(week([[0, 9, 1]], 1, 3))).toBe(false);
        expect(saysSomething(week([], 4, 50))).toBe(false);
        expect(saysSomething(week([[0, 9, 3]]))).toBe(true);
    });

    // Presence said where somebody is now; nothing said when they usually are.
    it("reads each account's week from the server, in the reader's own hours", async () => {
        const client = stubClient();
        const asked: Record<string, string>[] = [];
        (client as any).doesServerSupportUnstableFeature = async () => true;
        (client as any).http = {
            authedRequest: async (_m: string, path: string, query: Record<string, string>) => {
                asked.push({ path, ...query });
                if (path.includes("gone")) throw new Error("M_FORBIDDEN");
                return wire(week([[2, 20, 4]]));
            },
        };

        const got = await personWeek(client, person("@telegram_1:x", "@gone:x"), 1_000_000_000_000);

        expect(got?.seen[2][20]).toBe(4);
        expect(asked).toHaveLength(2);
        expect(asked[0]).toMatchObject({
            path: "/users/%40telegram_1%3Ax",
            week: "true",
            utc_offset_minutes: String(-new Date().getTimezoneOffset()),
        });
    });

    it("has nothing to show where the server keeps no log", async () => {
        const client = stubClient();
        (client as any).doesServerSupportUnstableFeature = async () => false;
        expect(await personWeek(client, person("@a:x"))).toBeUndefined();
    });
});
