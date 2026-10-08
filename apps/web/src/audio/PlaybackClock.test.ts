/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { PlaybackClock } from "./PlaybackClock";

describe("PlaybackClock", () => {
    let position: number;
    let clock: PlaybackClock;

    beforeEach(() => {
        vi.useFakeTimers();
        position = 0;
        clock = new PlaybackClock(() => position);
        clock.durationSeconds = 30;
    });

    afterEach(() => {
        clock.destroy();
        vi.useRealTimers();
    });

    it("reads zero until it is started", () => {
        position = 12;
        expect(clock.timeSeconds).toBe(0);
    });

    it("reads where the clip is while it plays, however fast that is", () => {
        clock.flagStart();
        position = 12.5;
        expect(clock.timeSeconds).toBe(12.5);
    });

    it("never reads past the end", () => {
        clock.flagStart();
        position = 31;
        expect(clock.timeSeconds).toBe(30);
    });

    it("keeps its place when paused, and goes back to the start when stopped", () => {
        clock.flagStart();
        position = 9;
        clock.flagPause();
        expect(clock.timeSeconds).toBe(9);

        clock.flagStop();
        expect(clock.timeSeconds).toBe(0);
    });

    it("tells listeners as the position moves, and only then", () => {
        const updates: number[][] = [];
        clock.liveData.onUpdate((value) => updates.push(value));
        clock.flagStart();
        updates.length = 0;

        position = 1;
        vi.advanceTimersByTime(50);
        vi.advanceTimersByTime(50); // nothing moved
        position = 2;
        vi.advanceTimersByTime(50);

        expect(updates).toEqual([
            [1, 30],
            [2, 30],
        ]);
    });

    it("stops polling while paused", () => {
        clock.flagStart();
        clock.flagPause();
        const updates = vi.fn();
        clock.liveData.onUpdate(updates);

        position = 5;
        vi.advanceTimersByTime(1000);

        expect(updates).not.toHaveBeenCalled();
    });

    it("counts a seek of a stopped clip as being paused there", () => {
        position = 14;
        clock.syncTo();
        expect(clock.timeSeconds).toBe(14);
    });

    it("uses the duration of the event until the clip's own is known", () => {
        const fresh = new PlaybackClock(() => 0);
        fresh.populatePlaceholdersFrom({ getContent: () => ({ info: { duration: 7000 } }) } as never);
        expect(fresh.durationSeconds).toBe(7);

        fresh.durationSeconds = 6.8;
        expect(fresh.durationSeconds).toBe(6.8);
        fresh.destroy();
    });
});
