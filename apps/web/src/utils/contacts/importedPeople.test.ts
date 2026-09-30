/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it, vi } from "vitest";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { CARD_EVENT_TYPE } from "./card";
import { accountId, allPeople, groupAccounts, withReaderNames } from "./people";
import DMRoomMap from "../DMRoomMap";

const clientWith = (cards: Record<string, unknown>): MatrixClient =>
    ({
        getSafeUserId: () => "@me:e",
        getVisibleRooms: () => [],
        getRooms: () => [],
        getAccountData: (type: string) => (type === CARD_EVENT_TYPE ? { getContent: () => ({ cards }) } : undefined),
    }) as unknown as MatrixClient;

describe("people who are only a card", () => {
    /*
     * The bug this is here for: an import stored two hundred cards and the list showed none of them,
     * because the list was built from chats and bridge address books and never read the cards back. Most
     * of an address book is people you are not currently messaging.
     */
    it("puts an imported contact in the list even with no chat and no Matrix ID", async () => {
        vi.spyOn(DMRoomMap, "shared").mockReturnValue({
            getUserIdForRoomId: () => undefined,
            getRoomIds: () => new Set(),
        } as unknown as DMRoomMap);
        const client = clientWith({
            "vcard:Ada Lovelace": {
                firstName: "Ada",
                lastName: "Lovelace",
                phones: [{ label: "mobile", value: "+447700900123" }],
            },
        });

        const people = await allPeople(client, { ask: false });
        expect(people.map((person) => person.name)).toEqual(["Ada Lovelace"]);
        // And with the number it was imported with, which is what later merges it with a bridged chat.
        expect(people[0].keys).toEqual(["tel:+447700900123"]);
    });

    /*
     * A card with no name, nickname, number or email was stored as "vcard:" and listed under that key. It
     * goes by what it has instead; one with nothing at all is left out.
     */
    it("names a card without a name by what it has, never by its key", async () => {
        vi.spyOn(DMRoomMap, "shared").mockReturnValue({
            getUserIdForRoomId: () => undefined,
            getRoomIds: () => new Set(),
        } as unknown as DMRoomMap);
        const client = clientWith({
            "vcard:": { company: "Acme Plumbing" },
            "vcard:#k1": { social: [{ service: "instagram", handle: "someone.x" }] },
            "vcard:#k2": { note: "" },
        });

        const names = (await allPeople(client, { ask: false })).map((person) => person.name);
        expect(names).toEqual(["Acme Plumbing", "someone.x"]);
        expect(names.some((name) => name.startsWith("vcard:"))).toBe(false);
    });

    it("goes by the name on the reader's card before the chat's", async () => {
        vi.spyOn(DMRoomMap, "shared").mockReturnValue({
            getUserIdForRoomId: () => undefined,
            getRoomIds: () => new Set(),
        } as unknown as DMRoomMap);
        const client = clientWith({ "@whatsapp_1:e": { firstName: "Mark", lastName: "Otherson" } });
        const [person] = withReaderNames(client, [
            {
                id: "@whatsapp_1:e",
                name: "~ MK ~",
                accounts: [{ network: "WhatsApp", mxid: "@whatsapp_1:e", remoteId: "1", name: "~ MK ~", keys: [] }],
                keys: [],
                rooms: [],
                saved: false,
                details: [],
            } as never,
        ]);
        expect(person.name).toBe("Mark Otherson");
    });

    it("leaves a card stored against a Matrix ID to the person it belongs to", async () => {
        vi.spyOn(DMRoomMap, "shared").mockReturnValue({
            getUserIdForRoomId: () => undefined,
            getRoomIds: () => new Set(),
        } as unknown as DMRoomMap);
        const client = clientWith({ "@ada:e": { firstName: "Ada" } });
        expect(await allPeople(client, { ask: false })).toEqual([]);
    });
});

describe("merging a card with a chat", () => {
    /*
     * The merge a reader most wants to make: an imported card and the bridged contact it belongs to, where
     * the numbers are not written the same way so nothing matched them automatically. Links used to be
     * recorded by Matrix ID alone, and a vCard has none - so this was the one merge the list refused.
     */
    it("links a card that has no Matrix ID to one that does", async () => {
        vi.spyOn(DMRoomMap, "shared").mockReturnValue({
            getUserIdForRoomId: () => undefined,
            getRoomIds: () => new Set(),
        } as unknown as DMRoomMap);
        const client = clientWith({
            "vcard:Ada": { firstName: "Ada", phones: [{ label: "mobile", value: "07700 900123" }] },
            "vcard:Bob": { firstName: "Bob", phones: [{ label: "mobile", value: "+447700900999" }] },
        });

        const apart = await allPeople(client, { ask: false });
        expect(apart).toHaveLength(2);

        // The reader says they are one person, naming the accounts by whatever identifies them.
        const linked = groupAccounts(
            apart.flatMap((person) => person.accounts),
            [apart.flatMap((person) => person.accounts.map(accountId))],
        );
        expect(linked).toHaveLength(1);
    });
});
