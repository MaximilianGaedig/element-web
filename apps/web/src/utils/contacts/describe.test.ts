/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";

import { describeCard, differingKeys } from "./describe";

describe("reading a card out as lines", () => {
    it("leaves out the fields it does not have", () => {
        expect(describeCard({ firstName: "Ada" }).map((line) => line.key)).toEqual(["firstName"]);
    });

    it("gives a repeated field one line per entry, so one of them can change on its own", () => {
        const lines = describeCard({
            phones: [
                { label: "mobile", value: "+1" },
                { label: "work", value: "+2" },
            ],
        });
        expect(lines.map((line) => line.key)).toEqual(["phones.0", "phones.1"]);
        expect(lines[1]).toMatchObject({ label: "work", value: "+2" });
    });

    it("writes an address as one line in the order it would be posted", () => {
        const [line] = describeCard({
            addresses: [{ label: "home", street: "1 Lovelace St", city: "London", country: "UK" }],
        });
        expect(line.value).toBe("1 Lovelace St, London, UK");
    });

    /* Another address book's own properties are carried, never understood, so they are counted not printed. */
    it("counts the properties it does not understand rather than showing them", () => {
        const [line] = describeCard({ extra: ["X-ABC:1", "X-DEF:2"] });
        expect(line).toMatchObject({ key: "extra", value: "2" });
    });

    it("falls back to the kind of field when an entry carries no label of its own", () => {
        expect(describeCard({ emails: [{ label: "", value: "a@e" }] })[0].label).toBeTruthy();
    });
});

describe("comparing a version with the card in force", () => {
    it("marks a line whose value moved on", () => {
        const lines = describeCard({ firstName: "Ada", nickname: "A" });
        expect([...differingKeys(lines, { firstName: "Augusta", nickname: "A" })]).toEqual(["firstName"]);
    });

    it("marks a line the current card no longer has at all", () => {
        expect(differingKeys(describeCard({ notes: "hi" }), {}).has("notes")).toBe(true);
    });

    it("marks nothing when the version is what the card already says", () => {
        const card = { firstName: "Ada", phones: [{ label: "mobile", value: "+1" }] };
        expect(differingKeys(describeCard(card), card).size).toBe(0);
    });
});
