/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach } from "vitest";

import { PLAYBACK_SPEEDS, PlaybackSpeed } from "./PlaybackSpeed";

describe("PlaybackSpeed", () => {
    beforeEach(() => localStorage.clear());

    it("is normal speed until one is chosen", () => {
        expect(PlaybackSpeed.current).toBe(1);
    });

    it("goes through the offered speeds and back to normal", () => {
        expect(PlaybackSpeed.cycle()).toBe(1.5);
        expect(PlaybackSpeed.cycle()).toBe(2);
        expect(PlaybackSpeed.cycle()).toBe(1);
        expect(PLAYBACK_SPEEDS).toEqual([1, 1.5, 2]);
    });

    it("is remembered", () => {
        PlaybackSpeed.set(2);
        expect(PlaybackSpeed.current).toBe(2);
    });

    it("ignores a stored speed that is not offered", () => {
        localStorage.setItem("mx_voice_message_speed", "7");
        expect(PlaybackSpeed.current).toBe(1);
    });

    it("tells listeners about a change, and not about the same speed again", () => {
        const listener = vi.fn();
        const stop = PlaybackSpeed.subscribe(listener);

        PlaybackSpeed.set(1.5);
        PlaybackSpeed.set(1.5);
        expect(listener).toHaveBeenCalledTimes(1);

        stop();
        PlaybackSpeed.set(2);
        expect(listener).toHaveBeenCalledTimes(1);
    });
});
