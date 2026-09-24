/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";

import { emailKey, identityKeys, phoneKey, readKey } from "./identity";

describe("recognising one person across networks", () => {
    it("reads a phone number the same way however it was written", () => {
        expect(phoneKey("+44 1632 960 123")).toBe("tel:+441632960123");
        expect(phoneKey("+44-1632-960-123")).toBe("tel:+441632960123");
        expect(identityKeys(["tel:+441632960123"])).toEqual(["tel:+441632960123"]);
        expect(identityKeys(["+44 1632 960 123"])).toEqual(["tel:+441632960123"]);
    });

    it("refuses a number with no country, because two of those cannot be compared", () => {
        // 1632960123 in Poland and 1632960123 somewhere else are different people, and nothing here knows
        // which country the reader is in. Merging them is silent and unrecoverable, so it is not done.
        expect(phoneKey("1632 960 123")).toBeUndefined();
        expect(identityKeys(["1632960123"])).toEqual([]);
    });

    it("never turns an account id into a phone number", () => {
        // The trap this exists for: a WhatsApp ghost's localpart IS a phone number (wa_441632960123) and a
        // Messenger one is NOT (facebook_100000000000001), though both are digits. Only what the network
        // published as a number counts.
        expect(identityKeys(["100000000000001"])).toEqual([]);
        expect(identityKeys(["@facebook_100000000000001:example.org"])).toEqual([]);
        expect(identityKeys(["fbid:100000000000001"])).toEqual([]);
    });

    it("keeps usernames out: they are unique on one network and meaningless across two", () => {
        expect(identityKeys(["alice", "username:anna", "@anna:example.org"])).toEqual([]);
    });

    it("reads an email address, and does not care about its case", () => {
        expect(emailKey("Alice@Example.ORG")).toBe("mailto:alice@example.org");
        expect(identityKeys(["mailto:Alice@Example.org"])).toEqual(["mailto:alice@example.org"]);
        expect(identityKeys(["alice@example.org"])).toEqual(["mailto:alice@example.org"]);
    });

    it("gives back several keys for somebody the network knows two ways", () => {
        expect(identityKeys(["tel:+441632960123", "mailto:alice@example.org", "alice"])).toEqual([
            "tel:+441632960123",
            "mailto:alice@example.org",
        ]);
    });

    it("shows a key as the number or address itself", () => {
        expect(readKey("tel:+441632960123")).toBe("+441632960123");
        expect(readKey("mailto:alice@example.org")).toBe("alice@example.org");
    });
});
