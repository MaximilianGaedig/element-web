/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";
import { type User } from "matrix-js-sdk/src/matrix";

import { hasPresenceBadge, lastActiveTs, presenceInfo, presenceTag } from "./activity";
import { formatPresence } from "./lastSeen";

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

const activeAgo = (ms: number): User => user({ presence: "offline", lastPresenceTs: NOW, lastActiveAgo: ms });

describe("presenceInfo", () => {
    it("is online while online or currently active, with no tag", () => {
        expect(presenceInfo(user({ presence: "online" }), NOW)?.online).toBe(true);
        expect(presenceInfo(user({ presence: "unavailable", currentlyActive: true }), NOW)?.online).toBe(true);
        expect(presenceTag(presenceInfo(user({ presence: "online" }), NOW))).toBeUndefined();
        expect(hasPresenceBadge(presenceInfo(user({ presence: "online" }), NOW))).toBe(true);
    });

    it("counts whole minutes since the homeserver's last-active time", () => {
        const u = user({ presence: "offline", lastPresenceTs: NOW - 10 * MIN, lastActiveAgo: 20 * MIN });
        expect(lastActiveTs(u)).toBe(NOW - 30 * MIN);
        expect(presenceInfo(u, NOW)).toEqual({ online: false, lastActive: NOW - 30 * MIN, minutes: 30 });
        expect(presenceInfo(activeAgo(5 * MIN + 59_000), NOW)?.minutes).toBe(5); // never rounds up
    });

    it("ignores status messages: presence is the only source", () => {
        const u = user({
            presence: "offline",
            presenceStatusMsg: `last seen ${new Date(NOW - 2 * MIN).toISOString()}`,
        });
        expect(presenceInfo(u, NOW)).toEqual({ online: false });
        expect(hasPresenceBadge(presenceInfo(u, NOW))).toBe(false);
        expect(presenceInfo(null, NOW)).toBeUndefined();
    });
});

describe("presenceTag", () => {
    const at = (ms: number): string | undefined => presenceTag(presenceInfo(activeAgo(ms), NOW));

    it("counts minutes for the first hour, then hours, for a day", () => {
        expect(at(20_000)).toBe("1m");
        expect(at(MIN)).toBe("1m");
        expect(at(59 * MIN)).toBe("59m");
        expect(at(60 * MIN)).toBe("1h");
        expect(at(150 * MIN)).toBe("2h");
        expect(at((23 * 60 + 59) * MIN)).toBe("23h");
        expect(at(24 * 60 * MIN)).toBeUndefined();
    });

    it("always agrees with the last-seen text", () => {
        for (let s = 60; s < 3600; s += 7) {
            const info = presenceInfo(activeAgo(s * 1000), NOW);
            const text = formatPresence(info, { now: NOW, locale: "en-GB", timeZone: "UTC" })!;
            const n = Number(presenceTag(info)!.slice(0, -1));
            expect(text).toBe(n === 1 ? "last seen 1 minute ago" : `last seen ${n} minutes ago`);
        }
    });
});
