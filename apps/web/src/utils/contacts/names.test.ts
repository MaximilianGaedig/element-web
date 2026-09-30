/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";

import { filingName, splitName } from "./names";

describe("reading a display name", () => {
    it("reads the ordinary two-part name", () => {
        expect(splitName("Aleksandra Kowalczyk")).toEqual({ firstName: "Aleksandra", lastName: "Kowalczyk" });
    });

    it("keeps a middle name with the first, not the last", () => {
        expect(splitName("Ada Augusta Lovelace")).toEqual({ firstName: "Ada Augusta", lastName: "Lovelace" });
    });

    /*
     * The case that makes a naive split wrong rather than merely crude: taking the last word files these
     * under B and S, which is where nobody would look for them.
     */
    it("keeps a particle with the family name", () => {
        expect(splitName("Jan van der Berg")).toEqual({ firstName: "Jan", lastName: "van der Berg" });
        expect(splitName("Maria de Souza")).toEqual({ firstName: "Maria", lastName: "de Souza" });
    });

    it("reads the already-split form an address book exports", () => {
        expect(splitName("Kowalczyk, Aleksandra")).toEqual({ firstName: "Aleksandra", lastName: "Kowalczyk" });
    });

    it("does not take a suffix for the family name", () => {
        expect(splitName("Martin Luther King Jr.")).toEqual({ firstName: "Martin Luther", lastName: "King" });
        expect(splitName("Ada Lovelace PhD")).toEqual({ firstName: "Ada", lastName: "Lovelace" });
    });

    /*
     * Most of what a bridge hands over is not a two-part name, and guessing one is worse than saying there
     * is none: a phone number filed under its last four digits, or a username split in half, is a contact
     * the reader cannot find again.
     */
    it("finds no family name where there is not one", () => {
        expect(splitName("+44 7700 900123")).toEqual({});
        expect(splitName("andrzej_w")).toEqual({ firstName: "andrzej_w" });
        expect(splitName("Prince")).toEqual({ firstName: "Prince" });
        // No space between the parts, so there is nothing to split on.
        expect(splitName("田中")).toEqual({ firstName: "田中" });
        expect(splitName("   ")).toEqual({});
    });
});

describe("what a person files under", () => {
    /*
     * The bug: every bridged contact has a display name and no card, so falling back to the whole display
     * name filed all of them by first name whatever the setting said - and "sort by last name" looked like
     * it did nothing.
     */
    it("files a bridged contact by family name when that is the order", () => {
        expect(filingName("Aleksandra Kowalczyk", "last")).toBe("Kowalczyk Aleksandra");
        expect(filingName("Aleksandra Kowalczyk", "first")).toBe("Aleksandra Kowalczyk");
    });

    it("prefers what the reader typed over anything read out of a display name", () => {
        expect(filingName("dave", "last", { firstName: "David", lastName: "Brent" })).toBe("Brent David");
    });

    // "(work)" said which of two people it was, and was taken for the family name: filed under "(" = #.
    it("never takes an aside in brackets for a family name", () => {
        expect(filingName("Marek (work)", "last")).toBe("Marek (work)");
        expect(filingName("Jan Nowak (work)", "last")).toBe("Nowak (work) Jan");
        expect(filingName("Jan Nowak [old number]", "last")).toBe("Nowak [old number] Jan");
        expect(filingName("Ola 🎸", "last")).toBe("Ola 🎸");
    });

    // Somebody known only by their Matrix ID files under its first letter, not under "@".
    it("files a Matrix ID by its first letter", () => {
        expect(filingName("@alice:example.org", "last")).toBe("alice:example.org");
        expect(filingName("@alice:example.org", "first")).toBe("alice:example.org");
    });

    it("leaves a name with no family name alone in either order", () => {
        expect(filingName("Prince", "last")).toBe("Prince");
        expect(filingName("+44 7700 900123", "last")).toBe("+44 7700 900123");
    });
});
