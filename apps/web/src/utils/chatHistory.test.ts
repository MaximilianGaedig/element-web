/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";
import { type Room } from "matrix-js-sdk/src/matrix";

import {
    BACKFILL_EVENT_TYPE,
    backfillStatusOf,
    type BackfillStatus,
    historyPhase,
    IMPORT_STALE_MS,
    trackImport,
} from "./chatHistory";

function roomWith(content: unknown): Room {
    return {
        // The bridge writes the status as our own account data for the room; the state event is the
        // fallback for a bridge that has no double puppet.
        getAccountData: (type: string) =>
            type === BACKFILL_EVENT_TYPE && content ? { getContent: () => content } : undefined,
        currentState: {
            getStateEvents: (type: string, key: string) =>
                type === BACKFILL_EVENT_TYPE && key === "" && content ? { getContent: () => content } : null,
        },
    } as unknown as Room;
}

describe("backfillStatusOf", () => {
    it("reads what the bridge recorded", () => {
        const status = backfillStatusOf(
            roomWith({
                state: "running",
                bridged_messages: 1200,
                oldest_ts: 1_600_000_000_000,
                remote_total: 5000,
                batches: 3,
                command_prefix: "!tg",
                network: "Telegram",
                updated_ts: 1,
            }),
        );
        expect(status).toMatchObject({
            state: "running",
            bridged_messages: 1200,
            remote_total: 5000,
            command_prefix: "!tg",
            network: "Telegram",
        });
    });

    it("says nothing for a room the bridge never described", () => {
        expect(backfillStatusOf(roomWith(undefined))).toBeUndefined();
    });

    it("ignores a state it doesn't know", () => {
        expect(backfillStatusOf(roomWith({ state: "sideways" }))).toBeUndefined();
    });
});

const base: BackfillStatus = {
    state: "running",
    bridged_messages: 100,
    batches: 1,
    command_prefix: "!tg",
    network: "Telegram",
    updated_ts: 1_000_000,
};

describe("historyPhase", () => {
    it("is importing while a batch came in lately", () => {
        expect(historyPhase({ ...base, active: true }, base.updated_ts + 1000)).toBe("importing");
    });

    it("is queued when the chat isn't the one being worked on", () => {
        expect(historyPhase({ ...base, active: false }, base.updated_ts + 1000)).toBe("queued");
    });

    it("is queued once a running import goes quiet", () => {
        expect(historyPhase({ ...base, active: true }, base.updated_ts + IMPORT_STALE_MS + 1)).toBe("queued");
    });

    it("maps the other states", () => {
        expect(historyPhase({ ...base, state: "manual" })).toBe("paused");
        expect(historyPhase({ ...base, state: "complete" })).toBe("complete");
        expect(historyPhase({ ...base, state: "unavailable" })).toBe("unavailable");
    });
});

describe("trackImport", () => {
    it("uses the bridge's pace and works out what is left", () => {
        const progress = trackImport("!a:x", { ...base, remote_total: 1100, rate_per_min: 100 }, 5_000_000);
        expect(progress.left).toBe(1000);
        expect(progress.fraction).toBeCloseTo(100 / 1100);
        expect(progress.etaMs).toBeCloseTo(10 * 60_000);
    });

    it("measures its own pace from what it watched, once that's long enough", () => {
        trackImport("!b:x", { ...base, bridged_messages: 0, remote_total: 1000 }, 1_000_000);
        const later = trackImport("!b:x", { ...base, bridged_messages: 60, remote_total: 1000 }, 1_060_000);
        expect(later.perMinute).toBeCloseTo(60);
    });
});

describe("activity helpers", () => {
    it("shifts the week's hours into the reader's time zone", async () => {
        const { hourOfWeekLocal } = await import("./chatHistory");
        const utc = new Array<number>(168).fill(0);
        utc[0] = 5; // Monday 00:00 UTC
        expect(hourOfWeekLocal(utc, 120)[2]).toBe(5); // UTC+2: Monday 02:00 local
        expect(hourOfWeekLocal(utc, -60)[167]).toBe(5); // UTC-1: Sunday 23:00 local
    });

    it("sums the week into weekdays and hours of the day, and months into years", async () => {
        const { weekdayAndHour, perYear } = await import("./chatHistory");
        const week = new Array<number>(168).fill(1);
        const { weekdays, hoursOfDay } = weekdayAndHour(week);
        expect(weekdays).toEqual(new Array(7).fill(24));
        expect(hoursOfDay).toEqual(new Array(24).fill(7));
        expect(
            perYear([
                { month: "2023-11", count: 2 },
                { month: "2023-12", count: 3 },
                { month: "2024-01", count: 4 },
            ]),
        ).toEqual([
            { year: "2023", count: 5 },
            { year: "2024", count: 4 },
        ]);
    });
});
