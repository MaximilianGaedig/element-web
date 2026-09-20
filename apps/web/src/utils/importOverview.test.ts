/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";
import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";

import { collectImports } from "./importOverview";

function room(id: string, content?: Record<string, unknown>): Room {
    return {
        roomId: id,
        name: id,
        currentState: {
            getStateEvents: (type: string) => (type === "im.mxg.backfill" && content ? { getContent: () => content } : null),
        },
    } as unknown as Room;
}

const base = { bridged_messages: 0, batches: 0, command_prefix: "!x", updated_ts: 1_000 };

describe("collectImports", () => {
    const now = 1_000 + 1000;
    const client = {
        getRooms: () => [
            room("!done", { ...base, state: "complete", network: "Telegram", bridged_messages: 500, remote_total: 500 }),
            room("!now", { ...base, state: "running", active: true, rate_per_min: 100, network: "Telegram", bridged_messages: 200, remote_total: 1200 }),
            room("!next", { ...base, state: "running", active: false, queue_ahead: 0, queue_size: 2, network: "Telegram", bridged_messages: 0, remote_total: 300 }),
            room("!wa", { ...base, state: "manual", network: "WhatsApp", bridged_messages: 40 }),
            room("!skip", { ...base, state: "skipped", network: "WhatsApp", bridged_messages: 5 }),
            room("!plain"),
        ],
    } as unknown as MatrixClient;

    it("counts chats by phase and leaves out rooms no bridge described", () => {
        const o = collectImports(client, now);
        expect(o.chats).toBe(5);
        expect(o.byPhase).toMatchObject({ complete: 1, importing: 1, queued: 1, paused: 1, skipped: 1 });
    });

    it("adds up messages, and progress over the chats the network can count", () => {
        const o = collectImports(client, now);
        expect(o.messages).toBe(745);
        expect(o.countedChats).toBe(3);
        expect(o.countedImported).toBe(700);
        expect(o.countedTotal).toBe(2000);
    });

    it("estimates the time left from what is left where totals are known and the pace of what is importing", () => {
        const o = collectImports(client, now);
        // (1200-200) + 300 left at 100 messages/min
        expect(o.etaMs).toBeCloseTo(13 * 60_000);
    });

    it("groups by network, busiest first, and puts the chat being imported before the queue", () => {
        const o = collectImports(client, now);
        expect(o.networks.map((n) => n.network)).toEqual(["Telegram", "WhatsApp"]);
        expect(o.entries.slice(0, 2).map((e) => e.room.roomId)).toEqual(["!now", "!next"]);
    });
});
