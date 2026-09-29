/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";

import { isOverscrolled } from "./overscroll";

/** A scroller with 400px of viewport onto 1000px of content: 600px is the bottom. */
const at = (scrollTop: number) => ({ scrollTop, scrollHeight: 1000, clientHeight: 400 });

describe("isOverscrolled", () => {
    it("says no while the scroller is anywhere inside its range", () => {
        expect(isOverscrolled(at(0))).toBe(false);
        expect(isOverscrolled(at(300))).toBe(false);
        expect(isOverscrolled(at(600))).toBe(false);
    });

    it("says no at either end exactly, so the panel still pins itself at the bottom", () => {
        // The case that matters: resting at the bottom must not read as a bounce, or the timeline
        // would stop following new messages, which is what the pinning exists for.
        expect(isOverscrolled(at(600))).toBe(false);
        expect(isOverscrolled(at(0))).toBe(false);
    });

    it("says yes past the bottom, which is a rubber-band bounce", () => {
        expect(isOverscrolled(at(600.5))).toBe(true);
        expect(isOverscrolled(at(742))).toBe(true);
    });

    it("says yes past the top, which is the same bounce the other way", () => {
        expect(isOverscrolled(at(-0.5))).toBe(true);
        expect(isOverscrolled(at(-120))).toBe(true);
    });

    it("says no for a scroller with nothing to scroll", () => {
        // Content shorter than the viewport: scrollHeight - clientHeight is negative, and a scrollTop
        // of 0 must not be read as past the end or the panel would never pin an almost-empty room.
        expect(isOverscrolled({ scrollTop: 0, scrollHeight: 200, clientHeight: 400 })).toBe(false);
    });
});
