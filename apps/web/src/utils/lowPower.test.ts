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

    describe("listening to the device", () => {
        afterEach(() => vi.unstubAllGlobals());

        /** A battery that can be told to change, as the browser's would. */
        function fakeBattery(level: number, charging: boolean): EventTarget & { level: number; charging: boolean } {
            return Object.assign(new EventTarget(), { level, charging });
        }

        it("follows the battery as it drains and as it is plugged in", async () => {
            const battery = fakeBattery(0.5, false);
            vi.stubGlobal("navigator", { getBattery: () => Promise.resolve(battery) });
            lowPower.start();
            await new Promise((resolve) => setTimeout(resolve, 0)); // the battery arrives
            expect(lowPower.isOn()).toBe(false);

            battery.level = 0.1;
            battery.dispatchEvent(new Event("levelchange"));
            expect(lowPower.isOn()).toBe(true);

            battery.charging = true;
            battery.dispatchEvent(new Event("chargingchange"));
            expect(lowPower.isOn()).toBe(false);
        });

        it("is on from the start for a battery already low", async () => {
            vi.stubGlobal("navigator", { getBattery: () => Promise.resolve(fakeBattery(0.1, false)) });
            lowPower.start();
            await vi.waitFor(() => expect(lowPower.isOn()).toBe(true));
        });

        it("is not thrown by a browser that has the battery method and will not let a page call it", async () => {
            vi.stubGlobal("navigator", { getBattery: () => Promise.reject(new Error("blocked")) });
            expect(() => lowPower.start()).not.toThrow();
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(lowPower.isOn()).toBe(false);
        });

        it("follows save-data as the reader turns it on and off", () => {
            const connection = Object.assign(new EventTarget(), { saveData: true });
            vi.stubGlobal("navigator", { connection });
            lowPower.start();
            expect(lowPower.isOn()).toBe(true);

            connection.saveData = false;
            connection.dispatchEvent(new Event("change"));
            expect(lowPower.isOn()).toBe(false);
        });

        it("starts listening once, however often it is asked to", () => {
            const getBattery = vi.fn(() => new Promise<never>(() => undefined));
            vi.stubGlobal("navigator", { getBattery });
            lowPower.start();
            lowPower.start();
            expect(getBattery).toHaveBeenCalledTimes(1);
        });

        describe("watching animation frames", () => {
            afterEach(() => vi.useRealTimers());

            /** Frames that arrive `gap` ms apart, as far as the page can tell. */
            function framesEvery(gap: number): void {
                let now = 0;
                vi.stubGlobal("requestAnimationFrame", (callback: (at: number) => void) =>
                    setTimeout(() => callback((now += gap)), 0),
                );
            }

            it("takes a second capped sample to call it a cap", async () => {
                vi.useFakeTimers();
                vi.stubGlobal("navigator", {});
                framesEvery(33.3);
                lowPower.start();

                // One could be a slow moment that happened to be even.
                await vi.advanceTimersByTimeAsync(16_000);
                expect(lowPower.isOn()).toBe(false);

                await vi.advanceTimersByTimeAsync(121_000);
                expect(lowPower.isOn()).toBe(true);
            });

            it("is not on for frames at sixty a second", async () => {
                vi.useFakeTimers();
                vi.stubGlobal("navigator", {});
                framesEvery(16.7);
                lowPower.start();

                await vi.advanceTimersByTimeAsync(300_000);
                expect(lowPower.isOn()).toBe(false);
            });

            it("is switched off again by a sample that is not capped", async () => {
                vi.useFakeTimers();
                vi.stubGlobal("navigator", {});
                framesEvery(33.3);
                lowPower.start();
                await vi.advanceTimersByTimeAsync(137_000);
                expect(lowPower.isOn()).toBe(true);

                framesEvery(16.7);
                await vi.advanceTimersByTimeAsync(121_000);
                expect(lowPower.isOn()).toBe(false);
            });
        });
    });
});
