/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it, vi } from "vitest";

import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import {
    type Account,
    type Person,
    LINKS_EVENT_TYPE,
    chosenName,
    chosenNames,
    namePerson,
    accountsOf,
    allPeople,
    dismissSuggestion,
    dismissedSuggestions,
    groupAccounts,
    linkAccounts,
    manualLinks,
    sameNameSuggestions,
    unlinkAccounts,
} from "./people";
import DMRoomMap from "../DMRoomMap";

const account = (network: string, mxid: string, name: string, keys: string[] = [], roomId?: string): Account => ({
    network,
    mxid,
    remoteId: mxid,
    name,
    keys,
    roomId,
});

/*
 * The same account from two places - the chat with them and the network's address book - used to be kept
 * twice in one person, so somebody showed Telegram twice.
 */
describe("the same account described twice", () => {
    it("is one account, pooling what each copy knew", () => {
        const fromChat = account("Telegram", "@telegram_1:e", "Mark", [], "!dm:e");
        const fromAddressBook: Account = {
            network: "Telegram",
            mxid: "@telegram_1:e",
            remoteId: "1",
            name: "Mark Otherson",
            keys: ["tel:+491701234567" as never],
            identifiers: ["tel:+491701234567"],
            saved: true,
        };
        const [person] = groupAccounts([fromChat, fromAddressBook]);
        expect(person.accounts).toHaveLength(1);
        expect(person.accounts[0]).toMatchObject({
            roomId: "!dm:e",
            name: "Mark",
            remoteId: "1",
            saved: true,
            identifiers: ["tel:+491701234567"],
        });
    });

    it("is recognised by the network's id when one copy has no ghost", () => {
        const withGhost: Account = {
            network: "Telegram",
            mxid: "@telegram_1:e",
            remoteId: "1",
            name: "Mark",
            keys: [],
        };
        const addressBookOnly: Account = { network: "Telegram", remoteId: "1", name: "Mark", keys: [], saved: true };
        const people = groupAccounts([withGhost, addressBookOnly]);
        expect(people).toHaveLength(1);
        expect(people[0].accounts).toHaveLength(1);
        expect(people[0].accounts[0]).toMatchObject({ mxid: "@telegram_1:e", saved: true });
    });

    it("keeps two different accounts of the same network apart", () => {
        const people = groupAccounts([
            account("Telegram", "@telegram_1:e", "Mark", ["tel:+1" as never]),
            account("Telegram", "@telegram_2:e", "Mark", ["tel:+1" as never]),
        ]);
        expect(people).toHaveLength(1);
        expect(people[0].accounts).toHaveLength(2);
    });
});

describe("grouping accounts into people", () => {
    it("makes one person out of two networks that publish the same number", () => {
        const people = groupAccounts([
            account("WhatsApp", "@wa_441632960123:example.org", "+441632960123", ["tel:+441632960123"]),
            account("Signal", "@signal_abc:example.org", "Alice", ["tel:+441632960123"], "!dm:example.org"),
        ]);
        expect(people).toHaveLength(1);
        expect(people[0].accounts.map((one) => one.network).sort()).toEqual(["Signal", "WhatsApp"]);
        // The name worth showing is the one from the chat the reader has actually seen, not the raw number.
        expect(people[0].name).toBe("Alice");
        expect(people[0].rooms).toEqual(["!dm:example.org"]);
    });

    it("keeps two people with the same name apart", () => {
        const people = groupAccounts([
            account("Signal", "@signal_one:example.org", "Bob Carter"),
            account("Messenger", "@facebook_2:example.org", "Bob Carter"),
        ]);
        expect(people).toHaveLength(2);
        // But it does say they might be worth linking, which is the reader's call and nobody else's.
        expect(sameNameSuggestions(people)).toEqual([{ reason: "same name", people }]);
    });

    it("folds a bridge's contact together with the chat that already exists with them", () => {
        const people = groupAccounts([
            account("Signal", "@signal_abc:example.org", "Alice"),
            account("Signal", "@signal_abc:example.org", "Alice Baker", [], "!dm:example.org"),
        ]);
        expect(people).toHaveLength(1);
        expect(people[0].name).toBe("Alice Baker");
    });

    it("applies a link the reader made, for people no number ties together", () => {
        const accounts = [
            account("Messenger", "@facebook_1:example.org", "Alice"),
            account("Telegram", "@telegram_2:example.org", "Alice B"),
        ];
        expect(groupAccounts(accounts)).toHaveLength(2);
        expect(groupAccounts(accounts, [["@facebook_1:example.org", "@telegram_2:example.org"]])).toHaveLength(1);
    });

    it("joins three accounts through a shared number even when only two of them share it directly", () => {
        // A ties to B by number, B ties to C by Matrix ID: all three are one person, which needs the
        // grouping to be transitive rather than pairwise.
        const people = groupAccounts([
            account("WhatsApp", "@wa_1:example.org", "Alice", ["tel:+441632960123"]),
            account("Signal", "@signal_2:example.org", "Alice", ["tel:+441632960123"]),
            account("Signal", "@signal_2:example.org", "Alice", [], "!dm:example.org"),
        ]);
        expect(people).toHaveLength(1);
        // B and C are the same Signal account described twice, so they are one account of the person.
        expect(people[0].accounts).toHaveLength(2);
        expect(people[0].accounts.find((one) => one.network === "Signal")?.roomId).toBe("!dm:example.org");
    });

    it("sorts people by name, so the list reads like a list", () => {
        const people = groupAccounts([
            account("Signal", "@b:example.org", "Carol"),
            account("Signal", "@a:example.org", "Alice"),
        ]);
        expect(people.map((one) => one.name)).toEqual(["Alice", "Carol"]);
    });
});

/** A client that holds one account-data event, which is all these functions read and write. */
function clientWith(content?: object): MatrixClient {
    let held = content;
    return {
        getAccountData: (type: string) => (type === LINKS_EVENT_TYPE && held ? { getContent: () => held } : undefined),
        setAccountData: async (_type: string, next: object) => {
            held = next;
        },
    } as unknown as MatrixClient;
}

const read = (client: MatrixClient): { links?: string[][]; dismissed?: string[][] } =>
    (client.getAccountData(LINKS_EVENT_TYPE) as unknown as { getContent: () => object } | undefined)?.getContent() ??
    {};

describe("what the reader decides about people nothing ties together", () => {
    const alice = account("Signal", "@signal_one:example.org", "Bob Carter");
    const bob = account("Messenger", "@facebook_2:example.org", "Bob Carter");

    it("offers the same name as a suggestion, and stops once it is turned down", () => {
        const people = groupAccounts([alice, bob]);
        expect(sameNameSuggestions(people)).toHaveLength(1);
        // The pairing the reader refused, recorded exactly as accountsOf writes it.
        expect(sameNameSuggestions(people, [accountsOf(people)])).toEqual([]);
    });

    it("records a merge and leaves the refusals alone", async () => {
        const client = clientWith({ dismissed: [["@x:example.org", "@y:example.org"]] });
        await linkAccounts(client, ["@signal_one:example.org", "@facebook_2:example.org"]);
        expect(read(client).links).toEqual([["@signal_one:example.org", "@facebook_2:example.org"]]);
        expect(read(client).dismissed).toEqual([["@x:example.org", "@y:example.org"]]);
    });

    it("records a refusal and leaves the links alone", async () => {
        const client = clientWith({ links: [["@a:example.org", "@b:example.org"]] });
        await dismissSuggestion(client, ["@facebook_2:example.org", "@signal_one:example.org"]);
        expect(read(client).links).toEqual([["@a:example.org", "@b:example.org"]]);
        // Sorted, so the same pair is the same record however the two were handed over.
        expect(read(client).dismissed).toEqual([["@facebook_2:example.org", "@signal_one:example.org"]]);
    });

    it("separates a person the reader merged, in one write rather than one per account", async () => {
        const client = clientWith();
        await linkAccounts(client, ["@signal_one:example.org", "@facebook_2:example.org"]);
        expect(groupAccounts([alice, bob], manualLinks(client))).toHaveLength(1);
        await unlinkAccounts(client, accountsOf(groupAccounts([alice, bob], manualLinks(client))));
        expect(read(client).links).toEqual([]);
        expect(groupAccounts([alice, bob], manualLinks(client))).toHaveLength(2);
    });

    it("ignores stored junk rather than handing it on or writing it back", async () => {
        const client = clientWith({ links: ["not a group", ["@only:example.org"], 7], dismissed: "nonsense" });
        expect(manualLinks(client)).toEqual([]);
        expect(dismissedSuggestions(client)).toEqual([]);
        await dismissSuggestion(client, ["@a:example.org", "@b:example.org"]);
        expect(read(client).links).toEqual([]);
    });
});

describe("names the reader gave", () => {
    const personOf = (...accounts: Account[]): Person => ({
        id: accounts[0].mxid!,
        name: "Ada",
        accounts,
        keys: [],
        rooms: [],
        saved: false,
        details: [],
    });
    const names = (client: MatrixClient): unknown => (read(client) as { names?: unknown }).names;

    it("writes the name against every one of their Matrix IDs", async () => {
        const client = clientWith();
        const person = personOf(account("Signal", "@sig:e", "Ada"), account("WhatsApp", "@wa:e", "Ada"));
        await namePerson(client, person, "Mum");
        expect(names(client)).toEqual({ "@sig:e": "Mum", "@wa:e": "Mum" });
    });

    /*
     * The point of keying on the Matrix IDs rather than the Person's id: that id is the first identity key
     * where there is one and a Matrix ID otherwise, so it moves the day a bridge starts publishing numbers.
     * A name typed before that day still has to be found after it.
     */
    it("finds the name again after the person is regrouped", () => {
        const client = clientWith({ names: { "@wa:e": "Mum" } });
        const regrouped = personOf(account("Signal", "@sig:e", "Ada"), account("WhatsApp", "@wa:e", "Ada"));
        expect(chosenName(client, regrouped)).toBe("Mum");
    });

    it("clears the name when handed nothing", async () => {
        const client = clientWith({ names: { "@sig:e": "Mum" } });
        await namePerson(client, personOf(account("Signal", "@sig:e", "Ada")), "");
        expect(names(client)).toEqual({});
    });

    it("keeps the links and refusals it was not asked to change", async () => {
        const client = clientWith({ links: [["@a:e", "@b:e"]], dismissed: [["@c:e", "@d:e"]] });
        await namePerson(client, personOf(account("Signal", "@sig:e", "Ada")), "Mum");
        expect(read(client).links).toEqual([["@a:e", "@b:e"]]);
        expect(read(client).dismissed).toEqual([["@c:e", "@d:e"]]);
    });

    it("ignores stored names that are not names", () => {
        const client = clientWith({ names: { "@sig:e": 42, "@wa:e": "Mum", "@x:e": "" } });
        expect(chosenNames(client)).toEqual({ "@wa:e": "Mum" });
    });
});

describe("identifiers a ghost publishes", () => {
    /*
     * The key and the place both matter, and both were wrong: the client read `identifiers` off the
     * member event, while mautrix writes `com.beeper.bridge.identifiers` into the MSC4133 profile. The
     * member event carries displayname, avatar_url and membership and nothing else, so months of
     * published phone numbers were read as no identifiers at all - which is why nothing ever merged.
     */
    it("reads com.beeper.bridge.identifiers from the profile, not the member event", async () => {
        const room = {
            roomId: "!dm:e",
            getMember: () => ({ rawDisplayName: "Ada", getMxcAvatarUrl: () => null }),
            currentState: { getStateEvents: () => [] },
        };
        const client = {
            getSafeUserId: () => "@me:e",
            getVisibleRooms: () => [room],
            getRooms: () => [],
            getExtendedProfile: vi.fn().mockResolvedValue({
                "com.beeper.bridge.identifiers": ["tel:+447700900123", "telegram:ada"],
                "displayname": "Ada",
            }),
            getAccountData: () => undefined,
        } as unknown as MatrixClient;
        vi.spyOn(DMRoomMap, "shared").mockReturnValue({
            getUserIdForRoomId: () => "@signal_x:e",
            getRoomIds: () => new Set(["!dm:e"]),
        } as unknown as DMRoomMap);

        const people = await allPeople(client);
        expect(client.getExtendedProfile).toHaveBeenCalledWith("@signal_x:e");
        // The number becomes a key, so this person can be matched with the same number elsewhere...
        expect(people[0].keys).toEqual(["tel:+447700900123"]);
        // ...and the handle is kept for showing, though it can never match.
        expect(people[0].details).toEqual([
            { kind: "phone", value: "+447700900123" },
            { kind: "handle", value: "telegram:ada" },
        ]);
    });

    /*
     * Discord publishes no identifiers at all, so a row built only from identifiers would say nothing
     * about it. The same profile does say which network and which account, and those are read from the
     * profile too rather than guessed from the mxid or from the room's bridge state event.
     */
    it("takes the network and the account id from the profile", async () => {
        const room = {
            roomId: "!dm:e",
            getMember: () => ({ rawDisplayName: "Ada", getMxcAvatarUrl: () => null }),
            currentState: { getStateEvents: () => [] },
        };
        const client = {
            getSafeUserId: () => "@me:e",
            getVisibleRooms: () => [room],
            getRooms: () => [],
            getExtendedProfile: vi.fn().mockResolvedValue({
                "com.beeper.bridge.network": "discord",
                "com.beeper.bridge.remote_id": "212938191",
            }),
            getAccountData: () => undefined,
        } as unknown as MatrixClient;
        vi.spyOn(DMRoomMap, "shared").mockReturnValue({
            getUserIdForRoomId: () => "@dc_212938191:e",
            getRoomIds: () => new Set(["!dm:e"]),
        } as unknown as DMRoomMap);

        const people = await allPeople(client);
        expect(people[0].accounts[0].network).toBe("discord");
        expect(people[0].accounts[0].remoteId).toBe("212938191");
        // Nothing to match on, so the row carries no keys rather than a made-up one.
        expect(people[0].keys).toEqual([]);
    });
});
