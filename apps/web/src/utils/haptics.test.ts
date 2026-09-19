/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const IPHONE_UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1";

async function load(): Promise<typeof import("./haptics")> {
    vi.resetModules();
    return import("./haptics");
}

describe("haptic", () => {
    const vibrate = navigator.vibrate;

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true, writable: true });
        document.body.innerHTML = "";
    });

    it("uses the Vibration API where there is one", async () => {
        const spy = vi.fn(() => true);
        Object.defineProperty(navigator, "vibrate", { value: spy, configurable: true, writable: true });
        const { haptic } = await load();
        haptic("success");
        expect(spy).toHaveBeenCalledWith([10, 60, 20]);
        expect(document.querySelector("input[switch]")).toBeNull();
    });

    it("clicks a hidden switch on iOS, once per tick", async () => {
        Object.defineProperty(navigator, "vibrate", { value: undefined, configurable: true, writable: true });
        vi.spyOn(navigator, "userAgent", "get").mockReturnValue(IPHONE_UA);
        const { haptic } = await load();
        const appClick = vi.fn();
        document.body.addEventListener("click", appClick);

        haptic("error");
        const input = document.querySelector<HTMLInputElement>("input[type=checkbox][switch]")!;
        expect(input).not.toBeNull();
        // Each label click toggles the switch (that toggle is what plays the haptic).
        const toggles = vi.fn();
        input.addEventListener("change", toggles);
        vi.advanceTimersByTime(100);

        expect(toggles).toHaveBeenCalledTimes(2); // the first of three ticks was synchronous, before we listened
        expect(appClick).not.toHaveBeenCalled();
        // Reused on the next call.
        haptic("light");
        expect(document.querySelectorAll("input[switch]")).toHaveLength(1);
    });

    it("does nothing elsewhere", async () => {
        Object.defineProperty(navigator, "vibrate", { value: undefined, configurable: true, writable: true });
        const { haptic } = await load();
        expect(() => haptic("medium")).not.toThrow();
        expect(document.querySelector("input[switch]")).toBeNull();
    });
});
