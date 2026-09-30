/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { personPresence, presenceNetwork } from "./presence";
import { type Person } from "./people";

const person = (...accounts: { network: string; mxid: string }[]): Person =>
    ({
        id: "p",
        name: "Ada",
        accounts: accounts.map((a) => ({ ...a, remoteId: a.mxid, keys: [] })),
        keys: [],
        rooms: [],
        saved: false,
        details: [],
    }) as unknown as Person;

const clientWith = (users: Record<string, { presence: string; lastActiveAgo?: number } | undefined>): MatrixClient =>
    ({ getUser: (mxid: string) => users[mxid] ?? null }) as unknown as MatrixClient;

describe("presence across networks", () => {
    it("takes the most awake of them, not the first or the last", () => {
        const client = clientWith({
            "@tg:e": { presence: "offline" },
            "@wa:e": { presence: "online", lastActiveAgo: 1000 },
            "@sig:e": { presence: "unavailable" },
        });
        const them = person(
            { network: "Telegram", mxid: "@tg:e" },
            { network: "WhatsApp", mxid: "@wa:e" },
            { network: "Signal", mxid: "@sig:e" },
        );
        expect(personPresence(client, them)).toBe("online");
        // And says where, because "about on WhatsApp" is the useful half of "about".
        expect(presenceNetwork(client, them)).toBe("WhatsApp");
    });

    /*
     * Silence is not absence. A bridge that does no presence at all would otherwise draw everybody on that
     * network as away, which is this screen stating something no network said.
     */
    it("says nothing when no network has said anything", () => {
        const client = clientWith({});
        expect(personPresence(client, person({ network: "Discord", mxid: "@dc:e" }))).toBeUndefined();
    });

    it("retires an online nobody has refreshed, rather than leaving them lit for good", () => {
        const client = clientWith({ "@tg:e": { presence: "online", lastActiveAgo: 60 * 60 * 1000 } });
        expect(personPresence(client, person({ network: "Telegram", mxid: "@tg:e" }))).toBe("unavailable");
    });

    it("counts a network's own idea of active as about", () => {
        const client = clientWith({ "@tg:e": { presence: "online", lastActiveAgo: 60 * 1000 } });
        expect(personPresence(client, person({ network: "Telegram", mxid: "@tg:e" }))).toBe("online");
    });
});
