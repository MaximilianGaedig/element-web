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
    it("is 1 while online or currently active", () => {
        expect(activityLevel(user({ presence: "online" }), NOW)).toBe(1);
        expect(activityLevel(user({ presence: "unavailable", currentlyActive: true }), NOW)).toBe(1);
    });

    it("fades linearly after the last activity, from the bridge's exact last-seen time", () => {
        const u = user({
            presence: "unavailable",
            presenceStatusMsg: `last seen ${new Date(NOW - 2 * MIN).toISOString()}`,
        });
        expect(activityLevel(u, NOW)).toBeCloseTo(1 - (2 * MIN) / ACTIVITY_FADE_MS, 5);
    });

    it("uses the homeserver's last_active_ago when there's no exact time", () => {
        const u = user({ presence: "offline", lastPresenceTs: NOW - 10 * MIN, lastActiveAgo: 20 * MIN });
        expect(lastActiveTs(u)).toBe(NOW - 30 * MIN);
        expect(activityLevel(u, NOW)).toBeCloseTo(1 - (30 * MIN) / ACTIVITY_FADE_MS, 5);
    });

    it("gives no dot for offline users without recent activity, or with a vague last seen", () => {
        expect(activityLevel(user({ presence: "offline" }), NOW)).toBe(0);
        expect(activityLevel(user({ presence: "unavailable", presenceStatusMsg: "last seen recently" }), NOW)).toBe(0);
        const hours = user({ presenceStatusMsg: `last seen ${new Date(NOW - 23 * 60 * MIN).toISOString()}` });
        expect(activityLevel(hours, NOW)).toBeGreaterThan(0); // tagged for a day
        const old = user({ presenceStatusMsg: `last seen ${new Date(NOW - 25 * 60 * MIN).toISOString()}` });
        expect(activityLevel(old, NOW)).toBe(0); // past the day
        expect(activityLevel(null, NOW)).toBe(0);
    });
});

describe("lastActiveTs", () => {
    it("prefers the bridge's exact last seen over the homeserver's last_active_ago", () => {
        // The bridge refreshed the presence 49 minutes ago; the network says 55.
        const u = user({
            presence: "offline",
            presenceStatusMsg: `last seen ${new Date(NOW - 55 * MIN).toISOString()}`,
            lastPresenceTs: NOW - 49 * MIN,
            lastActiveAgo: 0,
        });
        expect(lastActiveTs(u)).toBe(NOW - 55 * MIN);
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
