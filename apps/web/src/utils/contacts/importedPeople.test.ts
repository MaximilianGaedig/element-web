/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it, vi } from "vitest";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { CARD_EVENT_TYPE } from "./card";
import { allPeople } from "./people";
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

    it("leaves a card stored against a Matrix ID to the person it belongs to", async () => {
        vi.spyOn(DMRoomMap, "shared").mockReturnValue({
            getUserIdForRoomId: () => undefined,
            getRoomIds: () => new Set(),
        } as unknown as DMRoomMap);
        const client = clientWith({ "@ada:e": { firstName: "Ada" } });
        expect(await allPeople(client, { ask: false })).toEqual([]);
    });
});
