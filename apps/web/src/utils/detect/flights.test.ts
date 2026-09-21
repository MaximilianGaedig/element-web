/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";

import { detectFlights, flightUrl } from "./flights";

describe("detectFlights", () => {
    it.each([
        ["LO 381", "LO381", "LOT"],
        ["LH1234", "LH1234", "Lufthansa"],
        ["W6 1301", "W61301", "Wizz Air"],
        ["FR 8412", "FR8412", "Ryanair"],
        ["U2 5271", "U25271", "easyJet"],
    ])("reads %s", (text, flight, airline) => {
        const [found] = detectFlights(`boarding ${text} tomorrow`);
        expect([found.flight, found.airline]).toEqual([flight, airline]);
    });

    it("leaves alone anything whose airline does not exist", () => {
        // The shape of a flight number, and not one.
        expect(detectFlights("room PL 123")).toEqual([]);
        expect(detectFlights("model A4 210")).toEqual([]);
        expect(detectFlights("ZZ 999")).toEqual([]);
    });

    it("needs the code in capitals, as a flight number is written", () => {
        expect(detectFlights("lo 381")).toEqual([]);
    });

    it("says where it found one", () => {
        const [found] = detectFlights("we are on LO381");
        expect([found.start, found.end]).toEqual([10, 15]);
    });
});

describe("flightUrl", () => {
    it("points at a page that needs no account", () => {
        expect(flightUrl("LO381")).toBe("https://www.flightaware.com/live/flight/LO381");
    });
});
