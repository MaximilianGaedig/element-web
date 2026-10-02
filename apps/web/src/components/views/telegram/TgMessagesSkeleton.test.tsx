/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "test-utils-rtl";

import { TgMessagesSkeleton, skeletonBubbles } from "./TgMessagesSkeleton";

describe("TgMessagesSkeleton", () => {
    it("is the same conversation every time it is drawn", () => {
        expect(skeletonBubbles(20)).toEqual(skeletonBubbles(20));
    });

    it("has both sides in it, in runs, with messages of different lengths", () => {
        const bubbles = skeletonBubbles(20);

        expect(bubbles.some((bubble) => bubble.own)).toBe(true);
        expect(bubbles.some((bubble) => !bubble.own)).toBe(true);
        expect(new Set(bubbles.map((bubble) => bubble.lines)).size).toBeGreaterThan(1);
        expect(bubbles[0].continuation).toBe(false);
        bubbles.slice(1).forEach((bubble, index) => {
            expect(bubble.continuation).toBe(bubble.own === bubbles[index].own);
        });
        // The last of each run is the one the next bubble does not continue; the very last always is
        bubbles.forEach((bubble, index) => {
            expect(bubble.last).toBe(index === bubbles.length - 1 || !bubbles[index + 1].continuation);
        });
        for (const bubble of bubbles) {
            expect(bubble.width).toBeGreaterThanOrEqual(25);
            expect(bubble.width).toBeLessThanOrEqual(65);
        }
    });

    it("draws that many bubbles, each on its side, and says nothing to a screen reader", () => {
        const { container } = render(<TgMessagesSkeleton count={6} className="mine" />);
        const root = container.firstElementChild!;
        const expected = skeletonBubbles(6);

        expect(root).toHaveClass("mx_TgMessagesSkeleton", "mine");
        expect(root).toHaveAttribute("aria-hidden", "true");
        const drawn = [...root.querySelectorAll(".mx_TgMessagesSkeleton_bubble")];
        expect(drawn).toHaveLength(6);
        drawn.forEach((bubble, index) => {
            expect(bubble.classList.contains("mx_TgMessagesSkeleton_own")).toBe(expected[index].own);
            expect(bubble.classList.contains("mx_TgMessagesSkeleton_continuation")).toBe(expected[index].continuation);
            expect(bubble.classList.contains("mx_TgMessagesSkeleton_last")).toBe(expected[index].last);
        });
    });
});
