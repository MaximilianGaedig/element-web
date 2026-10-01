/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pipeline = vi.fn();
const dispose = vi.fn();
const run = vi.fn();

vi.mock("@huggingface/transformers", () => ({ pipeline }));

describe("transcribing a voice message", () => {
    let transcribe: typeof import("./transcribe");

    beforeEach(async () => {
        vi.useFakeTimers();
        // The model is module state: a fresh module is a fresh session.
        vi.resetModules();
        run.mockReset().mockResolvedValue({ text: " hello there " });
        dispose.mockReset().mockResolvedValue(undefined);
        pipeline.mockReset().mockImplementation(async () => Object.assign(run, { dispose }));

        // The browser's decoder and resampler, neither of which the test environment has.
        vi.stubGlobal(
            "AudioContext",
            class {
                public decodeAudioData = vi.fn().mockResolvedValue({ duration: 1 });
                public close = vi.fn().mockResolvedValue(undefined);
            },
        );
        vi.stubGlobal(
            "OfflineAudioContext",
            class {
                public destination = {};
                public createBufferSource = (): object => ({ connect: vi.fn(), start: vi.fn() });
                public startRendering = vi.fn().mockResolvedValue({ getChannelData: () => new Float32Array(16) });
            },
        );
        transcribe = await import("./transcribe");
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it("says what was said", async () => {
        expect(await transcribe.transcribe(new ArrayBuffer(8))).toBe("hello there");
    });

    // Whisper is a model of tens of megabytes plus the runtime it runs in. Kept for the session, one
    // transcript in the morning was that much memory until the tab was closed.
    it("lets the model go once nothing has been transcribed for a while", async () => {
        await transcribe.transcribe(new ArrayBuffer(8));
        expect(pipeline).toHaveBeenCalledTimes(1);
        expect(dispose).not.toHaveBeenCalled();
        expect(transcribe.transcriberLoaded()).toBe(true);

        await vi.advanceTimersByTimeAsync(transcribe.MODEL_IDLE_MS);

        expect(dispose).toHaveBeenCalledTimes(1);
        expect(transcribe.transcriberLoaded()).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("loads the model again for the next message", async () => {
        await transcribe.transcribe(new ArrayBuffer(8));
        await vi.advanceTimersByTimeAsync(transcribe.MODEL_IDLE_MS);

        expect(await transcribe.transcribe(new ArrayBuffer(8))).toBe("hello there");
        expect(pipeline).toHaveBeenCalledTimes(2);
    });

    it("keeps the model while messages keep being transcribed", async () => {
        for (let i = 0; i < 10; i++) {
            await transcribe.transcribe(new ArrayBuffer(8));
            await vi.advanceTimersByTimeAsync(transcribe.MODEL_IDLE_MS - 1);
        }

        expect(pipeline).toHaveBeenCalledTimes(1);
        expect(dispose).not.toHaveBeenCalled();
    });

    it("does not let the model go under a transcript that is still being worked out", async () => {
        const working = Promise.withResolvers<{ text: string }>();
        run.mockReturnValue(working.promise);

        const slow = transcribe.transcribe(new ArrayBuffer(8));
        await vi.advanceTimersByTimeAsync(transcribe.MODEL_IDLE_MS * 3);
        expect(dispose).not.toHaveBeenCalled();

        working.resolve({ text: "late" });
        expect(await slow).toBe("late");
        await vi.advanceTimersByTimeAsync(transcribe.MODEL_IDLE_MS);
        expect(dispose).toHaveBeenCalledTimes(1);
    });

    it("tries the model again after it failed to load", async () => {
        pipeline.mockRejectedValueOnce(new Error("offline"));
        expect(await transcribe.transcribe(new ArrayBuffer(8))).toBeUndefined();

        expect(await transcribe.transcribe(new ArrayBuffer(8))).toBe("hello there");
        expect(pipeline).toHaveBeenCalledTimes(2);
    });
});
