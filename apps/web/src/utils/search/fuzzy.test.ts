/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";

import { fuzzyMatch, fuzzyMatching } from "./fuzzy";

const named = (...names: string[]) => names.map((name) => ({ item: name, keys: [name] }));
const found = (names: string[], query: string) => fuzzyMatch(named(...names), query).map((match) => match.item);

describe("fuzzy matching names", () => {
    it("finds text through its accents, from a plain keyboard", () => {
        expect(found(["Zürich café"], "zurich")).toEqual(["Zürich café"]);
        expect(found(["Zürich café"], "cafe")).toEqual(["Zürich café"]);
        expect(found(["naïve"], "naive")).toEqual(["naïve"]);
        expect(found(["Łódź"], "lodz")).toEqual(["Łódź"]);
    });

    it("takes the words in any order", () => {
        expect(found(["Alice Baker"], "baker alice")).toEqual(["Alice Baker"]);
        expect(found(["Alice Baker"], "bak al")).toEqual(["Alice Baker"]);
    });

    it("forgives one typo per word, but not in the first letter", () => {
        expect(found(["Beatrix"], "beatirx")).toEqual(["Beatrix"]); // transposed
        expect(found(["Beatrix"], "beatrux")).toEqual(["Beatrix"]); // substituted
        expect(found(["Beatrix"], "betrix")).toEqual(["Beatrix"]); // dropped
        // The first letter is the one people get right; forgiving it makes every query match.
        expect(found(["Beatrix"], "deatrix")).toEqual([]);
    });

    it("only matches where a word starts, so a query stays precise", () => {
        expect(found(["mega man", "SuperMan", "walk_man"], "man")).toHaveLength(3);
        expect(found(["Tasmania"], "man")).toEqual([]);
    });

    it("puts the better match first", () => {
        // A name whose first word is the query beats one where it comes second.
        expect(found(["Alice Baker", "Baker Alice"], "baker")).toEqual(["Baker Alice", "Alice Baker"]);
    });

    it("matches an item on any of its keys, and counts it once", () => {
        const people = [{ item: "alice", keys: ["Alice Baker", "@alice_b:example.org"] }];
        expect(fuzzyMatch(people, "alice_b")).toHaveLength(1);
        expect(fuzzyMatch(people, "baker")).toHaveLength(1);
        // Both keys match: the person is still one row.
        expect(fuzzyMatch(people, "alice")).toHaveLength(1);
    });

    it("gives everything back for an empty query, in the order it came", () => {
        expect(found(["b", "a"], "  ")).toEqual(["b", "a"]);
        expect(fuzzyMatching(["b", "a"], "")).toEqual(new Set([0, 1]));
    });

    it("says which of a list of strings match, by position", () => {
        expect(fuzzyMatching(["Beatrix", "Carol", "Beatrice"], "bea")).toEqual(new Set([0, 2]));
    });

    it("respects a limit without losing the ranking", () => {
        expect(fuzzyMatch(named("Baker Alice", "Alice Baker", "Bakersfield"), "baker", { limit: 2 })).toHaveLength(2);
    });

    it("treats a digit after a letter as a word boundary", () => {
        // "iPhone15" is two words to a reader, so "15" has to find it, and "man" has to find "0007man".
        expect(found(["iPhone15 pro"], "15")).toEqual(["iPhone15 pro"]);
        expect(found(["0007man"], "man")).toEqual(["0007man"]);
    });

    it("prefers the match with less text the reader did not ask for", () => {
        expect(found(["123456badger", "123456"], "123456")).toEqual(["123456", "123456badger"]);
        // ...but equal-length matches keep the order the caller gave them in.
        expect(found(["room2", "room1"], "room")).toEqual(["room2", "room1"]);
    });

    it("matches whole words in prose, not pieces of them", () => {
        const messages = named("sent you the photos", "photosynthesis lecture");
        expect(fuzzyMatch(messages, "photos", { mode: "prose" }).map((m) => m.item)).toEqual(["sent you the photos"]);
    });
});
