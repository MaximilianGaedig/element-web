/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";

import { detectEntities, detectLinks, icsForEvent } from "./entities";

// A Monday, so "tomorrow" is unambiguous in every language below.
const now = new Date(2026, 8, 21, 9, 0, 0);
const at = (text: string) => detectEntities(text, { now, country: "PL" });

describe("detectLinks", () => {
    it("finds links with and without a scheme, and email addresses", async () => {
        const found = detectLinks("see https://example.com/a, www.example.org or write to me@example.com");
        expect(found.map((u) => u.url)).toEqual([
            "https://example.com/a",
            "http://www.example.org",
            "mailto:me@example.com",
        ]);
    });

    it("leaves the sentence's punctuation out of the link", () => {
        expect(detectLinks("go to https://example.com/page.")[0].url).toBe("https://example.com/page");
    });

    it("finds nothing in text that only looks like one", () => {
        expect(detectLinks("version 1.2.3 of the thing")).toEqual([]);
    });
});

describe("dates and times, in the languages chrono speaks", () => {
    it.each([
        ["English", "meeting tomorrow at 6pm"],
        ["German", "Treffen morgen um 18:00"],
        ["Dutch", "morgen om 18:00"],
        ["Russian", "завтра в 18:00"],
        ["Ukrainian", "завтра о 18:00"],
        ["Spanish", "mañana a las 18:00"],
        ["Italian", "domani alle 18:00"],
    ])("reads tomorrow evening in %s", async (_language, text) => {
        const found = (await at(text)).find((e) => e.kind === "datetime");
        expect(found?.date.getDate()).toBe(22);
        expect(found?.date.getHours()).toBe(18);
    });

    it.each([
        ["jutro o 18:00", 22, 18],
        ["spotkanie jutro o 18", 22, 18],
        ["pojutrze o 9:30", 23, 9],
        ["dzisiaj o 20:00", 21, 20],
    ])("reads Polish, which chrono does not speak: %s", async (text, day, hour) => {
        const found = (await at(text)).find((e) => e.kind === "datetime");
        expect(found?.date.getDate()).toBe(day);
        expect(found?.date.getHours()).toBe(hour);
    });

    it("reads a Polish weekday as the next one", async () => {
        // The reference is a Monday, so Friday is four days off.
        const found = (await at("w piątek o 12:00")).find((e) => e.kind === "datetime");
        expect(found!.date.getDate()).toBe(25);
        expect(found!.date.getHours()).toBe(12);
    });

    it("reads a Polish written date", async () => {
        const found = (await at("spotkanie 24 grudnia o 10:00")).find((e) => e.kind === "datetime");
        expect([found!.date.getMonth(), found!.date.getDate(), found!.date.getHours()]).toEqual([11, 24, 10]);
    });

    it("does not make an appointment out of a time with no day", async () => {
        expect((await at("call me at 18:00")).filter((e) => e.kind === "datetime")).toEqual([]);
    });

    it("reads a written date", async () => {
        const found = (await at("let's meet on 2026-12-24 at 10:00")).find((e) => e.kind === "datetime");
        expect([found!.date.getFullYear(), found!.date.getMonth(), found!.date.getDate()]).toEqual([2026, 11, 24]);
        expect(found?.hasTime).toBe(true);
    });
});

describe("phone numbers", () => {
    it("finds a number written for its own country", async () => {
        const found = (await at("call +48 22 123 45 67 about it")).find((e) => e.kind === "phone");
        expect(found?.number).toBe("+48221234567");
    });

    it("finds a local number when the region is known", async () => {
        const found = (await at("22 123 45 67")).find((e) => e.kind === "phone");
        expect(found?.number).toBe("+48221234567");
    });

    it("does not ring a number that is part of a link", async () => {
        const found = await at("https://example.com/+48221234567");
        expect(found.filter((e) => e.kind === "phone")).toEqual([]);
        expect(found.filter((e) => e.kind === "url")).toHaveLength(1);
    });
});

describe("everything together", () => {
    it("returns what it found in the order it appears", async () => {
        const found = await at("tomorrow at 9:00, see https://example.com");
        expect(found.map((f) => f.kind)).toEqual(["datetime", "url"]);
    });
});

describe("icsForEvent", () => {
    it("writes an appointment as an hour at the time given", () => {
        const ics = icsForEvent({ title: "Coffee", start: new Date(2026, 8, 22, 18, 30), hasTime: true });
        expect(ics).toContain("SUMMARY:Coffee");
        expect(ics).toMatch(/DTSTART:\d{8}T\d{6}Z/);
    });

    it("writes a day without a time as a whole day", () => {
        const ics = icsForEvent({ title: "Trip", start: new Date(2026, 8, 22), hasTime: false });
        expect(ics).toContain("DTSTART;VALUE=DATE:20260922");
        expect(ics).toContain("DTEND;VALUE=DATE:20260923");
    });

    it("escapes what the format reserves", () => {
        const ics = icsForEvent({ title: "Tea; cake, and a\nchat", start: new Date(2026, 8, 22), hasTime: false });
        expect(ics).toContain("SUMMARY:Tea\\; cake\\, and a\\nchat");
    });
});
