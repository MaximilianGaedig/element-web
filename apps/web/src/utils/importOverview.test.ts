/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";
import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";

import { collectImports, importHeadline } from "./importOverview";
import { type BridgeLogin } from "./bridgeLogins";

function room(id: string, content?: Record<string, unknown>): Room {
    return {
        roomId: id,
        name: id,
        getAccountData: () => undefined,
        currentState: {
            getStateEvents: (type: string) =>
                type === "im.mxg.backfill" && content ? { getContent: () => content } : null,
        },
    } as unknown as Room;
}

const base = { bridged_messages: 0, batches: 0, command_prefix: "!x", updated_ts: 1_000 };

describe("collectImports", () => {
    const now = 1_000 + 1000;
    const client = {
        getRooms: () => [
            room("!done", {
                ...base,
                state: "complete",
                network: "Telegram",
                bridged_messages: 500,
                remote_total: 500,
            }),
            room("!now", {
                ...base,
                state: "running",
                active: true,
                rate_per_min: 100,
                network: "Telegram",
                bridged_messages: 200,
                remote_total: 1200,
            }),
            room("!next", {
                ...base,
                state: "running",
                active: false,
                queue_ahead: 0,
                queue_size: 2,
                network: "Telegram",
                bridged_messages: 0,
                remote_total: 300,
            }),
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

describe("a bridge's own totals", () => {
    const now = 1_000 + 1000;
    // The management room, where the bridge says what it holds across every chat - including the ones
    // this client is not holding. Sliding sync means that is most of them.
    const management = {
        roomId: "!tg-management",
        name: "Telegram bridge",
        getAccountData: (type: string) =>
            type === "im.mxg.backfill_summary"
                ? {
                      getContent: () => ({
                          network: "Telegram",
                          chats: 60,
                          chats_by_state: { complete: 50, running: 9, skipped: 1 },
                          bridged_messages: 240_000,
                          remote_messages: 241_000,
                          counted_imported: 239_000,
                          counted_chats: 58,
                      }),
                  }
                : undefined,
        currentState: { getStateEvents: () => null },
    } as unknown as Room;
    const client = {
        getRooms: () => [
            management,
            room("!now", { ...base, state: "running", active: true, network: "Telegram", bridged_messages: 200 }),
            room("!done", { ...base, state: "complete", network: "Telegram", bridged_messages: 500 }),
        ],
    } as unknown as MatrixClient;

    it("replaces what the loaded rooms add up to", () => {
        const o = collectImports(client, now);
        expect(o).toMatchObject({
            chats: 60,
            messages: 240_000,
            countedChats: 58,
            countedImported: 239_000,
            countedTotal: 241_000,
        });
    });

    it("keeps the chat it can see importing, and counts the rest of the running ones as queued", () => {
        const o = collectImports(client, now);
        expect(o.byPhase).toMatchObject({ complete: 50, importing: 1, queued: 8, skipped: 1 });
    });

    it("still lists only the chats it holds", () => {
        const o = collectImports(client, now);
        expect(o.entries.map((e) => e.room.roomId)).toEqual(["!now", "!done"]);
    });
});

describe("importHeadline", () => {
    const login = (network: string, health: BridgeLogin["health"]): BridgeLogin => ({ network, health }) as BridgeLogin;
    const client = {
        getRooms: () => [
            room("!tg-done", { ...base, state: "complete", network: "Telegram", bridged_messages: 10 }),
            room("!tg-now", { ...base, state: "running", active: true, network: "Telegram" }),
            room("!wa-1", { ...base, state: "running", network: "WhatsApp" }),
            room("!wa-2", { ...base, state: "running", network: "WhatsApp" }),
        ],
    } as unknown as MatrixClient;

    it("separates what a bridge is working on from what waits for a login", () => {
        const overview = collectImports(client, 1_000 + 1000);
        const headline = importHeadline(overview, [login("Telegram", "connected"), login("WhatsApp", "disconnected")]);
        expect(headline).toMatchObject({ total: 4, open: 1, blocked: 2, done: 1, blockedNetworks: ["WhatsApp"] });
    });

    it("counts a network that reports no login at all as waiting for one", () => {
        const overview = collectImports(client, 1_000 + 1000);
        // WhatsApp is logged out, so it publishes no login state and isn't in the list.
        const headline = importHeadline(overview, [login("Telegram", "connected")]);
        expect(headline).toMatchObject({ open: 1, blocked: 2, blockedNetworks: ["WhatsApp"] });
    });
});
