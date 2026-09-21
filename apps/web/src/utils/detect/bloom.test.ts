/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";

import { FILTER_BITS_PER_NAME, hasName, normaliseLocality, readFilter, setBit } from "./bloom";

/** A filter over `names`, built exactly as the script that ships them builds one. */
function filterOf(names: string[]): (name: string) => boolean {
    const bits = Math.ceil(names.length * FILTER_BITS_PER_NAME);
    const bytes = new Uint8Array(Math.ceil(bits / 8));
    for (const name of names) setBit(bytes, bits, normaliseLocality(name));
    const out = new Uint8Array(4 + bytes.length);
    new DataView(out.buffer).setUint32(0, bits);
    out.set(bytes, 4);
    return readFilter(out.buffer);
}

describe("bloom", () => {
    it("finds every name that was put in", () => {
        // Every one of them, not most: a filter says "no" with certainty, so a name it was given and
        // cannot find is a broken filter. This is how a bit index that went negative was caught - a
        // typed array neither writes nor reads at one, and says nothing about it.
        const names = Array.from({ length: 5000 }, (_, index) => `Town ${index} ${index * 7919}`);
        const filter = filterOf(names);
        expect(names.filter((name) => !filter(name))).toEqual([]);
    });

    it("says no to names it was never given, nearly always", () => {
        const filter = filterOf(Array.from({ length: 5000 }, (_, index) => `Given ${index}`));
        const strangers = Array.from({ length: 5000 }, (_, index) => `Stranger ${index}`);
        const accepted = strangers.filter((name) => filter(name)).length;
        // Ten bits a name with seven hashes: about one in a hundred, and nowhere near one in twenty.
        expect(accepted / strangers.length).toBeLessThan(0.05);
    });

    it("reads a name however it was typed", () => {
        const filter = filterOf(["Bielsko-Biała", "Świnoujście"]);
        expect(filter("bielsko biala")).toBe(true);
        expect(filter("BIELSKO-BIAŁA")).toBe(true);
        expect(filter("swinoujscie")).toBe(true);
    });

    it("has nothing to say about one- and two-letter words, which would match ordinary ones", () => {
        const filter = filterOf(["Ås"]);
        expect(filter("Ås")).toBe(false);
    });

    it("answers from the bitmap alone, wherever it came from", () => {
        const bits = 64;
        const bytes = new Uint8Array(8);
        setBit(bytes, bits, "warszawa");
        expect(hasName(bytes, bits, "warszawa")).toBe(true);
    });
});
