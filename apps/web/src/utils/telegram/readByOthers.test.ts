/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";
import { type MatrixEvent, type Room, ReceiptType } from "matrix-js-sdk/src/matrix";

import { isReadByOthers } from "./readByOthers";

const event = (id: string, ts: number): MatrixEvent => ({ getId: () => id, getTs: () => ts }) as unknown as MatrixEvent;

/** A room whose live timeline is `events`, with `receipts` (user ids) on the named events. */
const roomWith = (
    events: MatrixEvent[],
    receipts: Record<string, string[]>,
    bots: string[] = [],
    serviceMembers: string[] = [],
): Room =>
    ({
        client: { getSafeUserId: () => "@me:e" },
        getLiveTimeline: () => ({ getEvents: () => events }),
        getReceiptsForEvent: (ev: MatrixEvent) =>
            (receipts[ev.getId()!] ?? []).map((userId) => ({ userId, type: ReceiptType.Read })),
        currentState: {
            getStateEvents: (type: string) =>
                type === "io.element.functional_members"
                    ? [{ getContent: () => ({ service_members: serviceMembers }) }]
                    : bots.map((bot) => ({ getContent: () => ({ bridgebot: bot }) })),
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

    // The room's service members are there to bridge, not to read: the bot, and the ghosts of our own accounts.
    it("does not count a service member's receipt", () => {
        const room = roomWith(events, { $3: ["@telegram_me:e"] }, [], ["@telegram_me:e"]);
        expect(events.map((ev) => isReadByOthers(room, ev))).toEqual([false, false, false]);
    });
});
