/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";

import { detectDateTimes, detectEntities, detectUrls, icsForEvent } from "./entities";

// A Monday, so "tomorrow" is unambiguous in the assertions below.
const now = new Date(2026, 8, 21, 9, 0, 0);

describe("detectUrls", () => {
    it("finds links with and without a scheme", () => {
        const found = detectUrls("see https://example.com/a and www.example.org too");
        expect(found.map((u) => u.url)).toEqual(["https://example.com/a", "https://www.example.org"]);
    });

    it("leaves the sentence's punctuation out of the link", () => {
        // A full stop ends far more sentences than URLs.
        expect(detectUrls("go to https://example.com/page.")[0].url).toBe("https://example.com/page");
        expect(detectUrls("(https://example.com/x)")[0].url).toBe("https://example.com/x");
    });

    it("finds nothing in text that only looks like one", () => {
        expect(detectUrls("version 1.2.3 of the thing")).toEqual([]);
    });
});

describe("detectDateTimes", () => {
    it("reads a date written day first", () => {
        const [found] = detectDateTimes("let's meet 21.09.2026", now);
        expect(found.date.getFullYear()).toBe(2026);
        expect(found.date.getMonth()).toBe(8);
        expect(found.date.getDate()).toBe(21);
        expect(found.hasTime).toBe(false);
    });

    it("reads an ISO date", () => {
        const [found] = detectDateTimes("on 2026-12-24", now);
        expect([found.date.getFullYear(), found.date.getMonth(), found.date.getDate()]).toEqual([2026, 11, 24]);
    });

    it("takes the date and the time after it as one thing", () => {
        const [found] = detectDateTimes("21.09 at 18:30 then", now);
        expect(found.hasTime).toBe(true);
        expect(found.date.getHours()).toBe(18);
        expect(found.date.getMinutes()).toBe(30);
        expect(found.text).toBe("21.09 at 18:30");
    });

    it("reads an afternoon written with am/pm", () => {
        const [found] = detectDateTimes("tomorrow at 6pm", now);
        expect(found.date.getDate()).toBe(22);
        expect(found.date.getHours()).toBe(18);
    });

    it("keeps midnight and noon the right way round", () => {
        expect(detectDateTimes("tomorrow at 12am", now)[0].date.getHours()).toBe(0);
        expect(detectDateTimes("tomorrow at 12pm", now)[0].date.getHours()).toBe(12);
    });

    it("does not make a date out of a day on its own", () => {
        // "tomorrow" in a sentence is a word, not an appointment.
        expect(detectDateTimes("I'll do it tomorrow", now)).toEqual([]);
    });

    it("does not make a date out of a number that is not one", () => {
        expect(detectDateTimes("31.02.2026 is not a day", now)).toEqual([]);
        expect(detectDateTimes("we scored 13.45 points", now)).toEqual([]);
    });

    it("does not read a bare hour as a time", () => {
        // "at 6" is as likely to be a count as an appointment.
        expect(detectDateTimes("there were 6 of us", now)).toEqual([]);
    });

    it("finds several, in the order they appear", () => {
        const found = detectDateTimes("21.09 at 10:00 and 22.09 at 11:00", now);
        expect(found).toHaveLength(2);
        expect(found[0].date.getDate()).toBe(21);
        expect(found[1].date.getDate()).toBe(22);
    });
});

describe("detectEntities", () => {
    it("returns links and times together, in the order they appear", () => {
        const found = detectEntities("tomorrow at 9:00, see https://example.com", now);
        expect(found.map((f) => f.kind)).toEqual(["datetime", "url"]);
    });
});

describe("icsForEvent", () => {
    it("writes an appointment as an hour at the time given", () => {
        const ics = icsForEvent({ title: "Coffee", start: new Date(2026, 8, 22, 18, 30), hasTime: true });
        expect(ics).toContain("BEGIN:VEVENT");
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
