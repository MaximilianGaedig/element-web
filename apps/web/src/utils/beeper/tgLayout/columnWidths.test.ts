/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    clampSidebarWidth,
    createLeftPreferencePersister,
    isEffectivelyCollapsed,
    loadLeftPreference,
    parseLeftPreference,
    preferenceForDrag,
    serialiseLeftPreference,
    visualLeftWidth,
} from "./columnWidths";
import { getScreenSize, isLessThanFloatingLeftSidebar, ScreenSize } from "./mediaSizes";
import { STORAGE_KEY_LEFT } from "./constants";

describe("tweb column widths", () => {
    describe("preferenceForDrag (installColumnResize.ts)", () => {
        it("collapses below MIN_SIDEBAR_WIDTH × SIDEBAR_COLLAPSE_FACTOR = 208px", () => {
            expect(preferenceForDrag(207)).toEqual({ collapsed: true });
            expect(preferenceForDrag(0)).toEqual({ collapsed: true });
            expect(preferenceForDrag(-40)).toEqual({ collapsed: true });
        });

        it("snaps to MIN_SIDEBAR_WIDTH between the threshold and 320px", () => {
            expect(preferenceForDrag(208)).toEqual({ collapsed: false, width: 320 });
            expect(preferenceForDrag(300)).toEqual({ collapsed: false, width: 320 });
        });

        it("follows the pointer inside [320, 480] and clamps above", () => {
            expect(preferenceForDrag(333)).toEqual({ collapsed: false, width: 333 });
            expect(preferenceForDrag(480)).toEqual({ collapsed: false, width: 480 });
            expect(preferenceForDrag(900)).toEqual({ collapsed: false, width: 480 });
        });

        it("never collapses while something is open inside the column", () => {
            expect(preferenceForDrag(100, true)).toEqual({ collapsed: false, width: 320 });
        });
    });

    describe("persistence (updateColumnWidths.ts)", () => {
        it("parses tweb's stored values", () => {
            expect(parseLeftPreference(null)).toEqual({ collapsed: false });
            expect(parseLeftPreference("garbage")).toEqual({ collapsed: false });
            expect(parseLeftPreference("0")).toEqual({ collapsed: true });
            expect(parseLeftPreference("400")).toEqual({ collapsed: false, width: 400 });
            expect(parseLeftPreference("10")).toEqual({ collapsed: false, width: 320 });
            expect(parseLeftPreference("9000")).toEqual({ collapsed: false, width: 480 });
        });

        it("stores the collapsed state as 0", () => {
            expect(serialiseLeftPreference({ collapsed: true })).toBe("0");
            expect(serialiseLeftPreference({ collapsed: false, width: 412 })).toBe("412");
        });

        describe("throttled writer", () => {
            beforeEach(() => {
                vi.useFakeTimers();
                localStorage.clear();
            });
            afterEach(() => {
                vi.useRealTimers();
            });

            it("writes the leading value, then the latest one after 200ms", () => {
                const persist = createLeftPreferencePersister(localStorage);
                persist({ collapsed: false, width: 350 });
                expect(localStorage.getItem(STORAGE_KEY_LEFT)).toBe("350");
                persist({ collapsed: false, width: 360 });
                persist({ collapsed: false, width: 370 });
                expect(localStorage.getItem(STORAGE_KEY_LEFT)).toBe("350");
                vi.advanceTimersByTime(200);
                expect(localStorage.getItem(STORAGE_KEY_LEFT)).toBe("370");
                persist({ collapsed: true });
                persist.flush();
                expect(loadLeftPreference(localStorage)).toEqual({ collapsed: true });
            });
        });
    });

    describe("visual width (computeVisualLeftWidth)", () => {
        it("uses the preference, the default or the collapsed strip on large screens", () => {
            expect(visualLeftWidth({ collapsed: false }, ScreenSize.large, 1440)).toBe(360);
            expect(visualLeftWidth({ collapsed: false, width: 420 }, ScreenSize.large, 1440)).toBe(420);
            expect(visualLeftWidth({ collapsed: true }, ScreenSize.large, 1440)).toBe(80);
        });

        it("ignores the preference in the floating range and fills the screen on handhelds", () => {
            expect(visualLeftWidth({ collapsed: true }, ScreenSize.medium, 800)).toBe(360);
            expect(visualLeftWidth({ collapsed: false, width: 470 }, ScreenSize.mobile, 390)).toBe(390);
            expect(isEffectivelyCollapsed({ collapsed: true }, ScreenSize.medium)).toBe(false);
            expect(isEffectivelyCollapsed({ collapsed: true }, ScreenSize.mobile)).toBe(false);
            expect(isEffectivelyCollapsed({ collapsed: true }, ScreenSize.large)).toBe(true);
        });

        it("clamps to [320, 480]", () => {
            expect(clampSidebarWidth(1)).toBe(320);
            expect(clampSidebarWidth(1000)).toBe(480);
        });
    });

    describe("screen tiers (mediaSizes.ts)", () => {
        it("matches tweb's breakpoints", () => {
            expect(getScreenSize(390)).toBe(ScreenSize.mobile);
            expect(getScreenSize(600)).toBe(ScreenSize.mobile);
            expect(getScreenSize(601)).toBe(ScreenSize.medium);
            expect(getScreenSize(925)).toBe(ScreenSize.medium);
            expect(getScreenSize(926)).toBe(ScreenSize.large);
            expect(getScreenSize(1440)).toBe(ScreenSize.large);
            expect(getScreenSize(2560)).toBe(ScreenSize.large);
            expect(isLessThanFloatingLeftSidebar(925)).toBe(true);
            expect(isLessThanFloatingLeftSidebar(926)).toBe(false);
        });
    });
});
