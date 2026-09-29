/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";

import { initialOf, sectionsOf } from "./sections";

describe("initialOf", () => {
    it("files a name under its first letter, upper-cased", () => {
        expect(initialOf("alice")).toBe("A");
        expect(initialOf("  bob")).toBe("B");
    });

    it("files an accented name under the unaccented letter, as a phone does", () => {
        expect(initialOf("Émile")).toBe("E");
        expect(initialOf("Ångström")).toBe("A");
    });

    it("files anything that does not start with a letter under #", () => {
        expect(initialOf("+49 170 1234567")).toBe("#");
        expect(initialOf("")).toBe("#");
        expect(initialOf("🙂 bot")).toBe("#");
    });
});

describe("sectionsOf", () => {
    const names = (sections: ReturnType<typeof sectionsOf<string>>): string[][] =>
        sections.map((section) => [section.letter, ...section.items]);

    it("groups by initial, in name order", () => {
        expect(names(sectionsOf(["Bob", "alice", "Ada"], (n) => n))).toEqual([
            ["A", "Ada", "alice"],
            ["B", "Bob"],
        ]);
    });

    it("keeps an accented name in its unaccented letter's section", () => {
        expect(names(sectionsOf(["Eve", "Émile"], (n) => n))).toEqual([["E", "Émile", "Eve"]]);
    });

    it("puts the # group last, however the names sort", () => {
        expect(names(sectionsOf(["+49 170", "Ada"], (n) => n))).toEqual([
            ["A", "Ada"],
            ["#", "+49 170"],
        ]);
    });

    it("offers no letter it has nothing for", () => {
        expect(sectionsOf([], (n: string) => n)).toEqual([]);
    });
});
