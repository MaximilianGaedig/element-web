/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";
import { type User } from "matrix-js-sdk/src/matrix";

import { ACTIVITY_FADE_MS, activityLevel, lastActiveTs } from "./activity";

const NOW = Date.UTC(2026, 8, 19, 12, 0, 0);
const MIN = 60 * 1000;

function user(fields: Partial<User>): User {
    return {
        presence: "offline",
        currentlyActive: false,
        lastActiveAgo: undefined,
        lastPresenceTs: 0,
        ...fields,
    } as User;
}

describe("activityLevel", () => {
    const activeAgo = (ms: number): User =>
        user({ presence: "offline", lastPresenceTs: NOW - MIN, lastActiveAgo: ms - MIN });

    it("is 1 while online or currently active", () => {
        expect(activityLevel(user({ presence: "online" }), NOW)).toBe(1);
        expect(activityLevel(user({ presence: "unavailable", currentlyActive: true }), NOW)).toBe(1);
    });

    it("fades over the day after the homeserver's last-active time", () => {
        const u = user({ presence: "offline", lastPresenceTs: NOW - 10 * MIN, lastActiveAgo: 20 * MIN });
        expect(lastActiveTs(u)).toBe(NOW - 30 * MIN);
        expect(activityLevel(u, NOW)).toBeCloseTo(1 - (30 * MIN) / ACTIVITY_FADE_MS, 5);
        expect(activityLevel(activeAgo(23 * 60 * MIN), NOW)).toBeGreaterThan(0); // tagged for a day
        expect(activityLevel(activeAgo(25 * 60 * MIN), NOW)).toBe(0); // past the day
    });

    it("ignores status messages: presence is the only source", () => {
        const u = user({
            presence: "offline",
            presenceStatusMsg: `last seen ${new Date(NOW - 2 * MIN).toISOString()}`,
        });
        expect(lastActiveTs(u)).toBeUndefined();
        expect(activityLevel(u, NOW)).toBe(0);
        expect(activityLevel(user({ presence: "offline" }), NOW)).toBe(0);
        expect(activityLevel(null, NOW)).toBe(0);
    });
});

describe("activityLabel", () => {
    it("counts minutes for the first hour, then hours", async () => {
        const { activityLabel } = await import("../../components/views/avatars/ActivityDot");
        const at = (minutes: number): string => activityLabel(1 - (minutes * MIN) / ACTIVITY_FADE_MS);
        expect(at(1)).toBe("1m");
        expect(at(59)).toBe("59m");
        expect(at(60)).toBe("1h");
        expect(at(150)).toBe("2h");
        expect(at(23 * 60 + 59)).toBe("23h");
    });
});
