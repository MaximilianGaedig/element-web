/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Low-power mode: doing less when the device is short of power.
 *
 * Telegram Web's "power saving" turns its costly effects off below a battery level. The same here, with
 * what a browser will say about power, which is not much and differs by browser:
 *
 *  - the battery itself (`navigator.getBattery()`: level and whether it is charging) - Chromium only;
 *  - "save data" (`navigator.connection.saveData`), which a reader turns on for the same reason;
 *  - the frame rate. iOS Low Power Mode and Chrome's Energy Saver both cap animation frames at about
 *    thirty a second and say so nowhere, so the cap is the only sign of them: frames arriving a steady
 *    33 ms apart, sample after sample, are a device that has been told to save power.
 *
 * The reader's own choice comes before all of it: always on, never on, or left to these signs.
 *
 * What being on changes is elsewhere - `html[data-low-power]` for the stylesheets, and
 * `lowPower.isOn()` for code that does work on a guess or for show. This says only whether it is on.
 *
 * Import-free on purpose: settings controllers and the app's shell both read it.
 */

export type LowPowerMode = "auto" | "on" | "off";

export interface PowerSignals {
    battery?: { level: number; charging: boolean };
    saveData?: boolean;
    /** Animation frames are being held to about thirty a second. */
    frameCapped?: boolean;
}

/** Below this share of a battery that is not charging, power is being saved. Telegram Web's own default. */
export const BATTERY_THRESHOLD = 0.2;

/** Whether low-power mode is on, given what the reader chose and what the device says. */
export function decideLowPower(mode: LowPowerMode, signals: PowerSignals): boolean {
    if (mode === "on") return true;
    if (mode === "off") return false;
    const { battery } = signals;
    if (battery && !battery.charging && battery.level <= BATTERY_THRESHOLD) return true;
    return !!signals.saveData || !!signals.frameCapped;
}

/** A frame every 33.3 ms is thirty a second. */
const CAPPED_INTERVAL_MS = 1000 / 30;
/** How far from that an interval may be and still count as one of the cap's. */
const CAPPED_TOLERANCE_MS = 4;
/** Fewer frames than this say nothing. */
const MIN_FRAMES = 45;

/**
 * Whether these gaps between animation frames are a cap at thirty a second rather than a busy page.
 *
 * A page that is slow drops frames unevenly: some 16 ms apart, some 50, some 120. A cap is even - nearly
 * every frame the same 33 ms after the last - so it is the evenness that is looked for, not the average.
 */
export function isFrameCapped(intervals: readonly number[]): boolean {
    if (intervals.length < MIN_FRAMES) return false;
    const even = intervals.filter((gap) => Math.abs(gap - CAPPED_INTERVAL_MS) <= CAPPED_TOLERANCE_MS).length;
    return even / intervals.length >= 0.8;
}

interface BatteryLike extends EventTarget {
    level: number;
    charging: boolean;
}

type Listener = () => void;

/** How many frames one sample watches, and how long between samples. */
const SAMPLE_FRAMES = 90;
const FIRST_SAMPLE_MS = 15_000;
const SAMPLE_EVERY_MS = 120_000;

class LowPower {
    private mode: LowPowerMode = "auto";
    private signals: PowerSignals = {};
    private on = false;
    private readonly listeners = new Set<Listener>();
    private started = false;
    private sampleTimer?: ReturnType<typeof setTimeout>;
    /** One capped sample could be a slow moment that happened to be even; two in a row is the cap. */
    private cappedSamples = 0;

    public isOn(): boolean {
        return this.on;
    }

    public subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /** What the reader chose. */
    public setMode(mode: LowPowerMode): void {
        this.mode = mode;
        this.decide();
    }

    /** What the device says, as far as it was just heard. */
    public report(signals: PowerSignals): void {
        this.signals = { ...this.signals, ...signals };
        this.decide();
    }

    /** Starts listening to the device. Safe to call more than once. */
    public start(): void {
        if (this.started || typeof navigator === "undefined") return;
        this.started = true;

        const nav = navigator as Navigator & {
            getBattery?: () => Promise<BatteryLike>;
            connection?: EventTarget & { saveData?: boolean };
        };
        void nav
            .getBattery?.()
            .then((battery) => {
                const read = (): void => this.report({ battery: { level: battery.level, charging: battery.charging } });
                battery.addEventListener("levelchange", read);
                battery.addEventListener("chargingchange", read);
                read();
            })
            // Not every browser that has the method lets a page call it.
            .catch(() => undefined);

        const { connection } = nav;
        if (connection) {
            const read = (): void => this.report({ saveData: !!connection.saveData });
            connection.addEventListener?.("change", read);
            read();
        }

        if (typeof requestAnimationFrame !== "undefined") {
            this.sampleTimer = setTimeout(() => this.sampleFrames(), FIRST_SAMPLE_MS);
        }
    }

    /** Watches a second or two of animation frames, when the page is on screen to have any. */
    private sampleFrames(): void {
        const again = (): void => {
            this.sampleTimer = setTimeout(() => this.sampleFrames(), SAMPLE_EVERY_MS);
        };
        // A hidden page gets no frames, or one a second: nothing to learn, and nothing to save either.
        if (typeof document !== "undefined" && document.visibilityState !== "visible") {
            again();
            return;
        }
        const intervals: number[] = [];
        let last: number | undefined;
        const frame = (at: number): void => {
            if (last !== undefined) intervals.push(at - last);
            last = at;
            if (intervals.length < SAMPLE_FRAMES) {
                requestAnimationFrame(frame);
                return;
            }
            this.cappedSamples = isFrameCapped(intervals) ? this.cappedSamples + 1 : 0;
            this.report({ frameCapped: this.cappedSamples >= 2 });
            again();
        };
        requestAnimationFrame(frame);
    }

    private decide(): void {
        const next = decideLowPower(this.mode, this.signals);
        if (next === this.on) return;
        this.on = next;
        // A copy, not the set: a listener may unsubscribe while being told.
        for (const listener of Array.from(this.listeners)) listener();
    }

    /**
     * Back to knowing nothing.
     * @knipignore - exported for tests
     */
    public reset(): void {
        clearTimeout(this.sampleTimer);
        this.mode = "auto";
        this.signals = {};
        this.cappedSamples = 0;
        this.started = false;
        this.decide();
    }
}

export const lowPower = new LowPower();
