/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { afterEach, describe, expect, it, vi } from "vitest";

import { BATTERY_THRESHOLD, decideLowPower, isFrameCapped, lowPower } from "./lowPower";

const frames = (count: number, gap: (index: number) => number): number[] =>
    Array.from({ length: count }, (_, i) => gap(i));

describe("low-power mode", () => {
    afterEach(() => lowPower.reset());

    it("is what the reader chose, whatever the device says", () => {
        const dying = { battery: { level: 0.02, charging: false }, saveData: true, frameCapped: true };
        expect(decideLowPower("on", {})).toBe(true);
        expect(decideLowPower("off", dying)).toBe(false);
    });

    it("left to the device, is on for a battery that is low and not charging", () => {
        expect(decideLowPower("auto", { battery: { level: BATTERY_THRESHOLD, charging: false } })).toBe(true);
        expect(decideLowPower("auto", { battery: { level: BATTERY_THRESHOLD + 0.01, charging: false } })).toBe(false);
        // Plugged in, there is nothing to save.
        expect(decideLowPower("auto", { battery: { level: 0.05, charging: true } })).toBe(false);
        // A browser that says nothing about its battery is not one that is low.
        expect(decideLowPower("auto", {})).toBe(false);
    });

    it("left to the device, is on for save-data and for a capped frame rate", () => {
        expect(decideLowPower("auto", { saveData: true })).toBe(true);
        expect(decideLowPower("auto", { frameCapped: true })).toBe(true);
        expect(decideLowPower("auto", { saveData: false, frameCapped: false })).toBe(false);
    });

    describe("telling a capped frame rate from a busy page", () => {
        it("sees a steady thirty frames a second as a cap", () => {
            expect(isFrameCapped(frames(90, (i) => 33.3 + (i % 3) - 1))).toBe(true);
        });

        it("sees sixty a second, and a hundred and twenty, as no cap", () => {
            expect(isFrameCapped(frames(90, () => 16.7))).toBe(false);
            expect(isFrameCapped(frames(90, () => 8.3))).toBe(false);
        });

        it("sees an uneven thirty a second as a slow page, not a cap", () => {
            // The same average, from frames that are 16 ms and 50 ms apart by turns.
            expect(isFrameCapped(frames(90, (i) => (i % 2 ? 16.7 : 50)))).toBe(false);
        });

        it("allows a cap the odd dropped frame", () => {
            expect(isFrameCapped(frames(90, (i) => (i % 10 === 0 ? 66.6 : 33.3)))).toBe(true);
        });

        it("says nothing from too few frames", () => {
            expect(isFrameCapped(frames(20, () => 33.3))).toBe(false);
        });
    });

    it("tells whoever is listening when it turns on and off, and only then", () => {
        const told = vi.fn();
        const stop = lowPower.subscribe(told);

        lowPower.report({ battery: { level: 0.5, charging: false } });
        expect(lowPower.isOn()).toBe(false);
        expect(told).not.toHaveBeenCalled();

        lowPower.report({ battery: { level: 0.1, charging: false } });
        expect(lowPower.isOn()).toBe(true);
        expect(told).toHaveBeenCalledTimes(1);

        // Lower still: already on.
        lowPower.report({ battery: { level: 0.05, charging: false } });
        expect(told).toHaveBeenCalledTimes(1);

        // The reader says never.
        lowPower.setMode("off");
        expect(lowPower.isOn()).toBe(false);
        expect(told).toHaveBeenCalledTimes(2);

        stop();
        lowPower.setMode("on");
        expect(lowPower.isOn()).toBe(true);
        expect(told).toHaveBeenCalledTimes(2);
    });

    it("keeps one sign when another is heard", () => {
        lowPower.report({ saveData: true });
        lowPower.report({ battery: { level: 0.9, charging: true } });
        expect(lowPower.isOn()).toBe(true);
    });
});
