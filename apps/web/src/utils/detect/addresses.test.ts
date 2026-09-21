/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { detectAddresses, mapUrl } from "./addresses";
import { readFilter } from "./bloom";

const one = (text: string): string | undefined => detectAddresses(text)[0]?.text;

describe("detectAddresses", () => {
    it.each([
        ["Polish", "spotkajmy się na ul. Marszałkowska 12", "ul. Marszałkowska 12"],
        ["Polish, with the postcode and town", "ul. Piękna 3, 00-950 Warszawa", "ul. Piękna 3, 00-950 Warszawa"],
        ["German", "wir sind in der Hauptstraße 5", "Hauptstraße 5"],
        ["German, abbreviated", "Bahnhofstr. 17a, 10115 Berlin", "Bahnhofstr. 17a, 10115 Berlin"],
        ["Dutch", "Kerkstraat 22, 1011 AB Amsterdam", "Kerkstraat 22, 1011 AB Amsterdam"],
        ["French", "10 rue de Rivoli, 75001 Paris", "10 rue de Rivoli, 75001 Paris"],
        ["Italian", "via Roma 14", "via Roma 14"],
        ["Spanish", "calle Gran Vía 28", "calle Gran Vía 28"],
        ["English", "123 Main Street", "123 Main Street"],
        ["English, abbreviated", "see you at 500 Oxford Rd.", "500 Oxford Rd."],
        ["Swedish", "Storgatan 4", "Storgatan 4"],
    ])("reads an address written in %s", (_language, text, expected) => {
        expect(one(text)).toBe(expected);
    });

    it("reads a street with no word marking it when a postcode and town follow", () => {
        expect(one("wpadnij na Morska 1, 76-032 Mielno")).toBe("Morska 1, 76-032 Mielno");
    });

    it("reads a bare street and town when the message is nothing else", () => {
        expect(one("Morska 1 Mielno")).toBe("Morska 1 Mielno");
        expect(one("  Morska 1 Mielno  ")).toBe("Morska 1 Mielno");
    });

    it("does not read a bare one out of a sentence, where it could be a thing's name", () => {
        // The same shape as an address, and not one.
        expect(detectAddresses("I sold my Nokia 3310 Classic last year")).toEqual([]);
        expect(detectAddresses("bought a Nokia 3310 Classic")).toEqual([]);
    });

    it("reads a flat number as part of the house number", () => {
        expect(one("ul. Długa 12/4")).toBe("ul. Długa 12/4");
    });

    it("needs a house number, so a street on its own is not an address", () => {
        expect(detectAddresses("we walked down Main Street for a while")).toEqual([]);
        expect(detectAddresses("mieszkam na ulicy Marszałkowskiej")).toEqual([]);
    });

    it("finds nothing in text that only has numbers in it", () => {
        expect(detectAddresses("I bought 12 of them for 5 each")).toEqual([]);
        expect(detectAddresses("version 2.3 of the way we do it")).toEqual([]);
    });

    it("reads two addresses in one message, in the order they appear", () => {
        const found = detectAddresses("from ul. Krótka 1 to Hauptstraße 9");
        expect(found.map((f) => f.text)).toEqual(["ul. Krótka 1", "Hauptstraße 9"]);
    });

    it("reports where it found one, so a caller can mark that span", () => {
        const [found] = detectAddresses("meet me at via Roma 14 tonight");
        expect(found.start).toBe(11);
        expect(found.end).toBe(22);
    });
});

describe("mapUrl", () => {
    it("looks a place up somewhere that needs no account", () => {
        expect(mapUrl("ul. Piękna 3, Warszawa")).toBe(
            "https://www.openstreetmap.org/search?query=ul.%20Pi%C4%99kna%203%2C%20Warszawa",
        );
    });
});

describe("with a list of the towns there are", () => {
    // The real thing, as the app fetches it: what this reads has to work against the actual names.
    const towns = readFilter(
        new Uint8Array(readFileSync(path.join(import.meta.dirname, "../../../res/locality/PL.bloom"))).buffer,
    );
    const inPoland = (text: string): string | undefined => detectAddresses(text, towns)[0]?.text;

    it("reads a street, a number and a town written plainly, inside a sentence", () => {
        expect(inPoland("wpadnij na Morska 1 Mielno w sobotę")).toBe("Morska 1 Mielno");
    });

    it("leaves the same shape alone when the last word is not a town", () => {
        expect(detectAddresses("I sold my Nokia 3310 Classic last year", towns)).toEqual([]);
        expect(detectAddresses("we shipped Wave 6 Element last month", towns)).toEqual([]);
    });

    it("still reads the ones that mark themselves", () => {
        expect(inPoland("ul. Marszałkowska 12 w Warszawie")).toBe("ul. Marszałkowska 12");
    });
});
