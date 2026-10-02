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

    describe("listening to the device", () => {
        afterEach(() => {
            vi.useRealTimers();
            vi.unstubAllGlobals();
        });

        /** A battery or a connection: something with a state that says when it changes. */
        function device<T extends object>(state: T): T & EventTarget {
            return Object.assign(new EventTarget(), state);
        }

        it("follows the battery as it drains and is plugged in", async () => {
            const battery = device({ level: 0.5, charging: false });
            vi.stubGlobal("navigator", { getBattery: async () => battery });

            lowPower.start();
            await Promise.resolve();
            await Promise.resolve();
            expect(lowPower.isOn()).toBe(false);

            battery.level = 0.15;
            battery.dispatchEvent(new Event("levelchange"));
            expect(lowPower.isOn()).toBe(true);

            battery.charging = true;
            battery.dispatchEvent(new Event("chargingchange"));
            expect(lowPower.isOn()).toBe(false);
        });

        it("starts the same on a browser that will not say anything about its battery", async () => {
            vi.stubGlobal("navigator", { getBattery: async () => Promise.reject(new Error("not allowed")) });
            lowPower.start();
            await Promise.resolve();
            await Promise.resolve();
            expect(lowPower.isOn()).toBe(false);
        });

        it("follows save-data as the reader turns it on and off", () => {
            const connection = device({ saveData: true });
            vi.stubGlobal("navigator", { connection });

            lowPower.start();
            expect(lowPower.isOn()).toBe(true);

            connection.saveData = false;
            connection.dispatchEvent(new Event("change"));
            expect(lowPower.isOn()).toBe(false);
        });

        /** Animation frames that arrive `gap` ms apart, as fast as they are asked for. */
        function frames(gap: () => number): void {
            let at = 0;
            vi.stubGlobal("requestAnimationFrame", (callback: (at: number) => void) => {
                at += gap();
                queueMicrotask(() => callback(at));
                return 0;
            });
        }

        it("takes a frame rate held at thirty a second, seen twice running, as the device saving power", async () => {
            vi.useFakeTimers();
            vi.stubGlobal("navigator", {});
            vi.stubGlobal("document", { visibilityState: "visible" });
            let gap = 33.3;
            frames(() => gap);

            lowPower.start();
            // The first look: capped, but once could be a slow moment that happened to be even.
            await vi.advanceTimersByTimeAsync(15_000);
            expect(lowPower.isOn()).toBe(false);
            // The second, two minutes on: still capped.
            await vi.advanceTimersByTimeAsync(120_000);
            expect(lowPower.isOn()).toBe(true);

            // Energy saver off again: sixty a second at the next look.
            gap = 16.7;
            await vi.advanceTimersByTimeAsync(120_000);
            expect(lowPower.isOn()).toBe(false);
        });

        it("learns nothing from a page that is not on screen", async () => {
            vi.useFakeTimers();
            vi.stubGlobal("navigator", {});
            vi.stubGlobal("document", { visibilityState: "hidden" });
            const asked = vi.fn();
            vi.stubGlobal("requestAnimationFrame", asked);

            lowPower.start();
            await vi.advanceTimersByTimeAsync(15_000 + 120_000);
            expect(asked).not.toHaveBeenCalled();
            expect(lowPower.isOn()).toBe(false);
        });

        it("listens once, however often it is started", () => {
            const getBattery = vi.fn(async () => device({ level: 1, charging: true }));
            vi.stubGlobal("navigator", { getBattery });
            lowPower.start();
            lowPower.start();
            expect(getBattery).toHaveBeenCalledTimes(1);
        });
    });

    it("keeps one sign when another is heard", () => {
        lowPower.report({ saveData: true });
        lowPower.report({ battery: { level: 0.9, charging: true } });
        expect(lowPower.isOn()).toBe(true);
    });
});
