/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";
import { type MatrixEvent, type Room, ReceiptType } from "matrix-js-sdk/src/matrix";

import { isAcceptedByBridge, isReadByOthers } from "./readByOthers";

const event = (id: string, ts: number): MatrixEvent => ({ getId: () => id, getTs: () => ts }) as unknown as MatrixEvent;

/** A room whose live timeline is `events`, with `receipts` (user ids) on the named events. */
const roomWith = (events: MatrixEvent[], receipts: Record<string, string[]>, bots: string[] = []): Room =>
    ({
        client: { getSafeUserId: () => "@me:e" },
        getLiveTimeline: () => ({ getEvents: () => events }),
        hasUserReadEvent: (userId: string, eventId: string) => {
            const at = events.findIndex((ev) => ev.getId() === eventId);
            return events.some((ev, i) => i >= at && (receipts[ev.getId()!] ?? []).includes(userId));
        },
        getReceiptsForEvent: (ev: MatrixEvent) =>
            (receipts[ev.getId()!] ?? []).map((userId) => ({ userId, type: ReceiptType.Read })),
        currentState: {
            getStateEvents: () => bots.map((bot) => ({ getContent: () => ({ bridgebot: bot }) })),
        },
    }) as unknown as Room;

describe("whether somebody else has read our message", () => {
    const events = [event("$1", 1), event("$2", 2), event("$3", 3)];

    // A receipt on a later event means everything before it was read too.
    it("counts every event up to the newest one somebody else read", () => {
        const room = roomWith(events, { $2: ["@ada:e"] });
        expect(events.map((ev) => isReadByOthers(room, ev))).toEqual([true, true, false]);
    });

    it("does not count our own receipt, or a bridge bot's", () => {
        const room = roomWith(events, { $3: ["@me:e", "@bot:e"] }, ["@bot:e"]);
        expect(events.map((ev) => isReadByOthers(room, ev))).toEqual([false, false, false]);
    });
});

// Bridges say a message reached their network with their bot's receipt, not a status event after it.
describe("whether a bridge got our message onto its network", () => {
    const events = [event("$1", 1), event("$2", 2), event("$3", 3)];

    it("counts every event up to the bridge bot's receipt", () => {
        const room = roomWith(events, { $2: ["@bot:e"] }, ["@bot:e"]);
        expect(events.map((ev) => isAcceptedByBridge(room, ev))).toEqual([true, true, false]);
    });

    it("does not take anybody else's receipt for the bridge's", () => {
        const room = roomWith(events, { $3: ["@ada:e"] }, ["@bot:e"]);
        expect(events.map((ev) => isAcceptedByBridge(room, ev))).toEqual([false, false, false]);
    });
});
