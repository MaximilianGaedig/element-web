/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";
import { type MatrixClient, type User } from "matrix-js-sdk/src/matrix";

import { personPresence } from "./presence";
import { type Person } from "./people";
import { presenceInfo } from "../presence/activity";

const NOW = 1_800_000_000_000;
const MIN = 60_000;

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

type Fake = { presence: string; lastActiveAgo?: number; lastPresenceTs?: number; currentlyActive?: boolean };

const clientWith = (users: Record<string, Fake | undefined>): MatrixClient =>
    ({
        getUser: (mxid: string) => (users[mxid] ? ({ userId: mxid, ...users[mxid] } as unknown as User) : null),
    }) as unknown as MatrixClient;

describe("presence across networks", () => {
    it("takes the most awake of them, not the first or the last", () => {
        const client = clientWith({
            "@tg:e": { presence: "offline", lastPresenceTs: NOW, lastActiveAgo: 90 * MIN },
            "@wa:e": { presence: "online", lastPresenceTs: NOW, lastActiveAgo: MIN },
            "@sig:e": { presence: "unavailable", lastPresenceTs: NOW, lastActiveAgo: 5 * MIN },
        });
        const them = person(
            { network: "Telegram", mxid: "@tg:e" },
            { network: "WhatsApp", mxid: "@wa:e" },
            { network: "Signal", mxid: "@sig:e" },
        );
        const got = personPresence(client, them, NOW);
        expect(got?.info.online).toBe(true);
        // And says where, because "about on WhatsApp" is the useful half of "about".
        expect(got?.network).toBe("WhatsApp");
    });

    it("among the quiet ones, takes whoever was active most recently", () => {
        const client = clientWith({
            "@tg:e": { presence: "offline", lastPresenceTs: NOW, lastActiveAgo: 90 * MIN },
            "@sig:e": { presence: "offline", lastPresenceTs: NOW, lastActiveAgo: 12 * MIN },
        });
        const got = personPresence(
            client,
            person({ network: "Telegram", mxid: "@tg:e" }, { network: "Signal", mxid: "@sig:e" }),
            NOW,
        );
        expect(got).toEqual({ info: { online: false, lastActive: NOW - 12 * MIN, minutes: 12 }, network: "Signal" });
    });

    /*
     * Silence is not absence. A bridge that does no presence at all would otherwise draw everybody on that
     * network as away, which is this screen stating something no network said.
     */
    it("says nothing when no network has said anything", () => {
        const client = clientWith({ "@dc:e": { presence: "offline" } });
        expect(personPresence(client, person({ network: "Discord", mxid: "@dc:e" }), NOW)).toBeUndefined();
        expect(personPresence(clientWith({}), person({ network: "Discord", mxid: "@dc:e" }), NOW)).toBeUndefined();
    });

    /*
     * The room list is the reference: whatever it draws on a face, the contact must draw the same. These
     * are the cases the contacts' own rule used to get differently.
     */
    it.each<[string, Fake]>([
        [
            "currently active, however long ago the last activity",
            {
                presence: "online",
                currentlyActive: true,
                lastPresenceTs: NOW,
                lastActiveAgo: 60 * MIN,
            },
        ],
        ["online with an old last-active", { presence: "online", lastPresenceTs: NOW, lastActiveAgo: 60 * MIN }],
        [
            "offline but active minutes ago",
            { presence: "offline", lastPresenceTs: NOW - 2 * MIN, lastActiveAgo: 3 * MIN },
        ],
        ["away since yesterday", { presence: "unavailable", lastPresenceTs: NOW, lastActiveAgo: 20 * 60 * MIN }],
    ])("reads %s exactly as the room list does", (_, user) => {
        const client = clientWith({ "@tg:e": user });
        const roomList = presenceInfo(client.getUser("@tg:e"), NOW);
        expect(personPresence(client, person({ network: "Telegram", mxid: "@tg:e" }), NOW)?.info).toEqual(roomList);
    });
});
