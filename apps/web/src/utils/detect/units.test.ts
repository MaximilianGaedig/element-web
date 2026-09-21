/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";

import { detectMeasures } from "./units";

const inPoland = (text: string): string | undefined => detectMeasures(text, "pl-PL")[0]?.converted;
const inTheStates = (text: string): string | undefined => detectMeasures(text, "en-US")[0]?.converted;

describe("detectMeasures", () => {
    it("converts what a metric reader does not think in", () => {
        expect(inPoland("it's 70°F outside")).toBe("21 °C");
        expect(inPoland("about 12 miles away")).toBe("19.3 km");
        expect(inPoland("6 feet tall")).toBe("1.83 m");
        expect(inPoland("he weighs 180 lbs")).toBe("81.65 kg");
        expect(inPoland("limit is 70 mph")).toBe("113 km/h");
    });

    it("converts the other way for a reader who thinks in miles", () => {
        expect(inTheStates("it's 21°C outside")).toBe("70 °F");
        expect(inTheStates("about 19 km away")).toBe("11.8 mi");
    });

    it("leaves a reader's own units alone", () => {
        expect(detectMeasures("it's 21°C outside", "pl-PL")).toEqual([]);
        expect(detectMeasures("about 19 km away", "pl-PL")).toEqual([]);
        expect(detectMeasures("70°F", "en-US")).toEqual([]);
    });

    it("reads a decimal comma, which is how it is written here", () => {
        expect(inPoland("2,5 miles")).toBe("4 km");
    });

    it("finds nothing in a number with no unit after it", () => {
        expect(detectMeasures("call me at 18:00", "pl-PL")).toEqual([]);
        expect(detectMeasures("I bought 12 of them", "pl-PL")).toEqual([]);
    });

    it("says where it found one, so the span can be marked", () => {
        const [found] = detectMeasures("about 12 miles away", "pl-PL");
        expect(found.text).toBe("12 miles");
    });
});
