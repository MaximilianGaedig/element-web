/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";

import { isWebPageSquarePhoto, limitSymbols, webPageDescription, webPageTitle } from "./webPage";

describe("tweb web page box", () => {
    describe("limitSymbols (helpers/string/limitSymbols.ts)", () => {
        it("leaves a string no longer than limitFrom whole", () => {
            expect(limitSymbols("a".repeat(100), 80, 100)).toBe("a".repeat(100));
        });

        it("cuts to length and appends an ellipsis past limitFrom", () => {
            expect(limitSymbols("a".repeat(101), 80, 100)).toBe("a".repeat(80) + "...");
        });

        it("trims before measuring", () => {
            expect(limitSymbols("   hi   ", 80, 100)).toBe("hi");
        });

        it("defaults limitFrom to length + 10", () => {
            expect(limitSymbols("a".repeat(10), 5)).toBe("a".repeat(10));
            expect(limitSymbols("a".repeat(16), 5)).toBe("aaaaa...");
        });
    });

    describe("webPageTitle / webPageDescription", () => {
        it("truncates the title at 80 once it passes 100 (wrapWebPageTitle)", () => {
            expect(webPageTitle("t".repeat(100))).toHaveLength(100);
            expect(webPageTitle("t".repeat(101))).toBe("t".repeat(80) + "...");
        });

        it("truncates the description at 150 once it passes 180 (wrapWebPageDescription)", () => {
            expect(webPageDescription("d".repeat(180))).toHaveLength(180);
            expect(webPageDescription("d".repeat(181))).toBe("d".repeat(150) + "...");
        });
    });

    describe("isWebPageSquarePhoto (bubbles.ts messageMediaWebPage)", () => {
        it("floats a square photo beside the text", () => {
            expect(isWebPageSquarePhoto({ width: 96, height: 96 }, true)).toBe(true);
        });

        it("treats an unmeasured photo as square", () => {
            expect(isWebPageSquarePhoto({}, true)).toBe(true);
            expect(isWebPageSquarePhoto(undefined, true)).toBe(true);
        });

        it("gives a photo of any other shape the full preview", () => {
            expect(isWebPageSquarePhoto({ width: 478, height: 249 }, true)).toBe(false);
            expect(isWebPageSquarePhoto({ width: 249, height: 478 }, true)).toBe(false);
        });

        it("needs text to float the thumbnail beside", () => {
            expect(isWebPageSquarePhoto({ width: 96, height: 96 }, false)).toBe(false);
            expect(isWebPageSquarePhoto(undefined, false)).toBe(false);
        });
    });
});
