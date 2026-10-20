/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";
import { type Room } from "matrix-js-sdk/src/matrix";

import {
    ALIAS_STATE_TYPE,
    CARD_STATE_TYPE,
    LEGACY_CARDS_TYPE,
    LEGACY_HISTORY_TYPE,
    POINTER_EVENT_TYPE,
    type Pointer,
    bookFromState,
    planSave,
    stateKeyOf,
} from "./addressBook";
import { type ContactCard, allCards, cardFor, saveCard, saveLooseCard } from "./card";
import { importCards } from "./importCards";
import { moveAddressBook } from "./moveAddressBook";
import { deleteRevision, forgetHistory, historyFor, loadHistory } from "./history";
import { type Person } from "./people";
import { fakeBookServer } from "./addressBook-mock";
import { CONTACTS_ROOM_TYPE } from "./bookRoom";
import { isRoomVisible } from "../../stores/room-list-v3/isRoomVisible";

const person = (...ids: string[]): Person =>
    ({
        id: ids[0],
        name: "Ada",
        accounts: ids.map((id) =>
            id.startsWith("vcard:")
                ? { network: "Contacts", remoteId: id, keys: [] }
                : { mxid: id, remoteId: id, keys: [] },
        ),
        keys: [],
        rooms: [],
        saved: false,
        details: [],
    }) as unknown as Person;

/** A phone's PHOTO line: big, base64, the thing that filled account data. */
const PHOTO = `PHOTO;ENCODING=b;TYPE=JPEG:/9j/${"A".repeat(80_000)}`;

/** Every piece of content the server holds for the account, as one string, for "is the photo still in there". */
const everything = (server: ReturnType<typeof fakeBookServer>): string =>
    JSON.stringify([[...server.account.values()], [...server.rooms.values()]]);

describe("the address book room", () => {
    it("stores one card per person and an alias for each other Matrix ID, never a copy", async () => {
        const server = fakeBookServer();
        await saveCard(server.client, person("@tg_ada:e", "@wa_ada:e"), { firstName: "Ada" });

        const [roomId] = server.rooms.keys();
        const state = await server.client.roomState(roomId);
        const cards = state.filter((one) => one.type === CARD_STATE_TYPE);
        const aliases = state.filter((one) => one.type === ALIAS_STATE_TYPE);
        expect(cards).toHaveLength(1);
        expect(aliases).toHaveLength(1);
        // A Matrix ID is not a state key we may send: the auth rules reserve "@..." to that user.
        expect(cards[0].state_key).toBe("user:@tg_ada:e");
        expect(aliases[0]).toMatchObject({ state_key: "user:@wa_ada:e", content: { card: "@tg_ada:e" } });
        // Found through either of them, and nothing written to global account data but the pointer.
        expect(cardFor(server.client, person("@wa_ada:e"))).toEqual({ firstName: "Ada" });
        expect([...server.account.keys()]).toEqual([POINTER_EVENT_TYPE]);
        expect((server.account.get(POINTER_EVENT_TYPE) as Pointer).room_id).toBe(roomId);
    });

    it("is typed so the room list and the spotlight leave it out", async () => {
        const server = fakeBookServer();
        await saveLooseCard(server.client, { firstName: "Ada" });
        const [roomId] = server.rooms.keys();
        const create = (await server.client.roomState(roomId)).find((one) => one.type === "m.room.create");
        expect(create?.content.type).toBe(CONTACTS_ROOM_TYPE);
        expect(isRoomVisible({ getType: () => CONTACTS_ROOM_TYPE, isSpaceRoom: () => false } as unknown as Room)).toBe(
            false,
        );
    });

    /* One card shared through an alias must not change for the id that is not this person's any more. */
    it("gives an id split off a person the card it had, rather than overwriting it for them", () => {
        const book = bookFromState("!r", [
            { type: CARD_STATE_TYPE, state_key: stateKeyOf("@a:e"), content: { card: { firstName: "Old" } } },
            { type: ALIAS_STATE_TYPE, state_key: stateKeyOf("@b:e"), content: { card: "@a:e" } },
        ]);
        const writes = planSave(book, ["@a:e"], { firstName: "New" }, "edit");
        expect(writes).toContainEqual({ kind: "card", id: "@b:e", card: { firstName: "Old" }, source: "edit" });
        expect(writes).toContainEqual({ kind: "alias", id: "@b:e" });
        expect(writes).toContainEqual({ kind: "card", id: "@a:e", card: { firstName: "New" }, source: "edit" });
    });

    it("writes nothing for a save that changes nothing", async () => {
        const server = fakeBookServer();
        await saveCard(server.client, person("@ada:e"), { firstName: "Ada" });
        const [roomId] = server.rooms.keys();
        const before = server.rooms.get(roomId)!.length;
        await saveCard(server.client, person("@ada:e"), { firstName: "Ada" });
        expect(server.rooms.get(roomId)!.length).toBe(before);
    });
});

describe("photos", () => {
    /*
     * The bug: an imported vCard's PHOTO line was kept verbatim in the card, and six of them were 87% of
     * the account data every new sync connection downloads.
     */
    it("moves an imported picture to media and keeps only its mxc: URI", async () => {
        const server = fakeBookServer();
        await importCards(server.client, [{ firstName: "Ada", extra: [PHOTO, "X-ABADR:pl"] }], []);

        const [card] = Object.values(allCards(server.client));
        expect(card.photoUrl).toMatch(/^mxc:\/\//);
        expect(card.extra).toEqual(["X-ABADR:pl"]);
        expect(server.media.get(card.photoUrl!)?.type).toBe("image/jpeg");
        expect(everything(server)).not.toContain("AAAAAAAAAA");
    });

    it("drops any other unknown line too big to carry", async () => {
        const server = fakeBookServer();
        await importCards(server.client, [{ firstName: "Ada", extra: [`X-BLOB:${"z".repeat(5000)}`] }], []);
        expect(Object.values(allCards(server.client))[0].extra).toBeUndefined();
    });
});

describe("history as the room's state changes", () => {
    it("lists the version a save replaced, with why, newest first", async () => {
        const server = fakeBookServer();
        const ada = person("@ada:e");
        await saveCard(server.client, ada, { firstName: "Ada" });
        await saveCard(server.client, ada, { firstName: "Augusta" }, "import");
        await saveCard(server.client, ada, { firstName: "Augusta", nickname: "A" }, "edit");

        const history = await loadHistory(server.client, ada);
        expect(history.map((one) => [one.source, one.was])).toEqual([
            ["edit", { firstName: "Augusta" }],
            ["import", { firstName: "Ada" }],
        ]);
    });

    it("deletes one version by redacting it, and the lot on request, keeping the card", async () => {
        const server = fakeBookServer();
        const ada = person("@ada:e");
        await saveCard(server.client, ada, { firstName: "A" });
        await saveCard(server.client, ada, { firstName: "B" });
        await saveCard(server.client, ada, { firstName: "C" });

        const [newest] = await loadHistory(server.client, ada);
        await deleteRevision(server.client, ada, newest);
        expect((await loadHistory(server.client, ada)).map((one) => one.was)).toEqual([{ firstName: "A" }]);

        await forgetHistory(server.client, ada);
        expect(await loadHistory(server.client, ada)).toEqual([]);
        expect(cardFor(server.client, ada)).toEqual({ firstName: "C" });
    });
});

describe("moving the address book out of account data", () => {
    /* What the live account looked like: copies per Matrix ID, a photo in `extra`, history with "before" copies. */
    function legacyServer() {
        const server = fakeBookServer();
        const ada: ContactCard = { firstName: "Ada", phones: [{ label: "mobile", value: "+44 7700" }], extra: [PHOTO] };
        const bob: ContactCard = { firstName: "Bob" };
        server.account.set(LEGACY_CARDS_TYPE, {
            cards: { "@tg_ada:e": ada, "@wa_ada:e": ada, "vcard:Bob": bob, "vcard:Cy": { firstName: "Cy" } },
        });
        server.account.set(LEGACY_HISTORY_TYPE, {
            history: {
                "@tg_ada:e": [
                    { ts: 300, source: "edit", was: { firstName: "Ada", extra: [PHOTO] } },
                    { ts: 200, source: "import", was: { firstName: "Adda" } },
                ],
                "@wa_ada:e": [
                    { ts: 300, source: "edit", was: { firstName: "Ada", extra: [PHOTO] } },
                    { ts: 200, source: "import", was: { firstName: "Adda" } },
                ],
            },
        });
        return server;
    }

    it("reads the old events until it has moved, and the room after", async () => {
        const server = legacyServer();
        expect(cardFor(server.client, person("@wa_ada:e"))?.firstName).toBe("Ada");
        expect(historyFor(server.client, person("@wa_ada:e"))).toHaveLength(2);

        expect(await moveAddressBook(server.client)).toBe(true);

        expect(cardFor(server.client, person("@wa_ada:e"))).toMatchObject({ firstName: "Ada" });
        expect(Object.keys(allCards(server.client)).sort()).toEqual([
            "@tg_ada:e",
            "@wa_ada:e",
            "vcard:Bob",
            "vcard:Cy",
        ]);
    });

    it("writes every card, verifies them, and only then empties the old events", async () => {
        const server = legacyServer();
        await moveAddressBook(server.client);

        expect(server.account.get(LEGACY_CARDS_TYPE)).toEqual({});
        expect(server.account.get(LEGACY_HISTORY_TYPE)).toEqual({});
        const pointer = server.account.get(POINTER_EVENT_TYPE) as Pointer;
        expect(pointer.pending).toBeUndefined();
        expect(pointer.backup).toMatch(/^mxc:\/\//);
        // The backup is the old events as they were, photo and all.
        const backup = JSON.parse(await server.media.get(pointer.backup!)!.text());
        expect(Object.keys(backup[LEGACY_CARDS_TYPE].cards)).toHaveLength(4);
        expect(backup[LEGACY_HISTORY_TYPE].history["@tg_ada:e"]).toHaveLength(2);

        const state = await server.client.roomState(pointer.room_id!);
        expect(state.filter((one) => one.type === CARD_STATE_TYPE && one.content.card)).toHaveLength(3);
        expect(state.filter((one) => one.type === ALIAS_STATE_TYPE && one.content.card)).toHaveLength(1);
        // The photo went up once, though the old events held it three times.
        const photoUrl = cardFor(server.client, person("@tg_ada:e"))?.photoUrl;
        expect(photoUrl).toMatch(/^mxc:\/\//);
        expect([...server.media.keys()].filter((url) => url !== pointer.backup)).toEqual([photoUrl]);
        // Nowhere in the account but the backup file.
        expect(JSON.stringify([[...server.account.values()], [...server.rooms.values()]])).not.toContain("AAAAAAAAAA");
    });

    it("carries the old history over as the card's earlier versions, with their times and reasons", async () => {
        const server = legacyServer();
        await moveAddressBook(server.client);
        const history = await loadHistory(server.client, person("@wa_ada:e"));
        expect(history.map(({ ts, source, was }) => ({ ts, source, firstName: was.firstName }))).toEqual([
            { ts: 300, source: "edit", firstName: "Ada" },
            { ts: 200, source: "import", firstName: "Adda" },
        ]);
        // The photo in the old "before" copy is the same upload, not a second one or the base64.
        expect(history[0].was.photoUrl).toBe(cardFor(server.client, person("@tg_ada:e"))?.photoUrl);
        expect(history[0].was.extra).toBeUndefined();
    });

    it("keeps the old events when what it reads back is not what it wrote", async () => {
        const server = legacyServer();
        server.corrupt("vcard:Bob");
        expect(await moveAddressBook(server.client)).toBe(false);

        expect(Object.keys((server.account.get(LEGACY_CARDS_TYPE) as { cards: object }).cards)).toHaveLength(4);
        expect((server.account.get(POINTER_EVENT_TYPE) as Pointer).pending).toBe(true);
        // Still read from the old events, so nothing the reader sees changed.
        expect(cardFor(server.client, person("vcard:Bob"))).toEqual({ firstName: "Bob" });

        // And the next try carries on in the same room and finishes.
        const roomId = (server.account.get(POINTER_EVENT_TYPE) as Pointer).room_id;
        expect(await moveAddressBook(server.client)).toBe(true);
        expect(server.rooms.size).toBe(1);
        expect((server.account.get(POINTER_EVENT_TYPE) as Pointer).room_id).toBe(roomId);
        expect(cardFor(server.client, person("vcard:Bob"))).toEqual({ firstName: "Bob" });
    });

    it("moves the old events in before the first write, so a save never strands the rest", async () => {
        const server = legacyServer();
        await saveCard(server.client, person("vcard:Cy"), { firstName: "Cyril" });
        expect(server.account.get(LEGACY_CARDS_TYPE)).toEqual({});
        expect(cardFor(server.client, person("vcard:Bob"))).toEqual({ firstName: "Bob" });
        expect(cardFor(server.client, person("vcard:Cy"))).toEqual({ firstName: "Cyril" });
    });

    it("does nothing for an account that never had cards", async () => {
        const server = fakeBookServer();
        expect(await moveAddressBook(server.client)).toBe(false);
        expect(server.rooms.size).toBe(0);
    });
});

describe("a room the reader left", () => {
    it("is copied to a new room on the next write, so no card is lost", async () => {
        const server = fakeBookServer();
        await saveCard(server.client, person("@a:e", "@b:e"), { firstName: "A" });
        await saveLooseCard(server.client, { firstName: "Loose" });
        const [first] = server.rooms.keys();
        server.forbid(first);

        await saveCard(server.client, person("@c:e"), { firstName: "C" });

        const pointer = server.account.get(POINTER_EVENT_TYPE) as Pointer;
        expect(pointer.room_id).not.toBe(first);
        expect(Object.keys(allCards(server.client)).sort()).toEqual(["@a:e", "@b:e", "@c:e", "vcard:Loose"]);
        const state = await server.client.roomState(pointer.room_id!);
        expect(state.filter((one) => one.type === CARD_STATE_TYPE)).toHaveLength(3);
    });
});
