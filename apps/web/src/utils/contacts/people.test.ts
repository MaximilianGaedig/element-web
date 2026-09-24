/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";

import { type Account, groupAccounts, sameNameSuggestions } from "./people";

const account = (network: string, mxid: string, name: string, keys: string[] = [], roomId?: string): Account => ({
    network,
    mxid,
    remoteId: mxid,
    name,
    keys,
    roomId,
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
        expect(people[0].accounts).toHaveLength(3);
    });

    it("sorts people by name, so the list reads like a list", () => {
        const people = groupAccounts([
            account("Signal", "@b:example.org", "Carol"),
            account("Signal", "@a:example.org", "Alice"),
        ]);
        expect(people.map((one) => one.name)).toEqual(["Alice", "Carol"]);
    });
});
