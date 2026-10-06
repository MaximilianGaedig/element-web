/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.fn();
const terminate = vi.fn();
/** Workers made, in order: what the page starts and ends, so a test can see the model come and go. */
const made: object[] = [];

/** The page's end of the transcriber worker, answering each request with whatever `run` gives. */
class FakeWorker {
    public onmessage?: (event: { data: unknown }) => void;
    public onerror?: (event: { message: string }) => void;
    public terminate = terminate;

    public constructor() {
        made.push(this);
    }

    public postMessage = ({
        seq,
        samples,
        language,
        among,
    }: {
        seq: number;
        samples: Float32Array;
        language?: string;
        among?: string[];
    }): void => {
        void Promise.resolve(run(samples, language, among)).then(
            (result: { text: string }) => this.onmessage?.({ data: { seq, text: result.text.trim() } }),
            (error: Error) => this.onmessage?.({ data: { seq, error: error.message } }),
        );
    };
}

vi.mock("../../workers/transcribeWorkerFactory", () => ({ default: () => new FakeWorker() }));

describe("transcribing a voice message", () => {
    let transcribe: typeof import("./transcribe");

    beforeEach(async () => {
        vi.useFakeTimers();
        // The model is module state: a fresh module is a fresh session.
        vi.resetModules();
        run.mockReset().mockResolvedValue({ text: " hello there " });
        terminate.mockReset();
        made.length = 0;

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
        expect(made).toHaveLength(1);
        expect(terminate).not.toHaveBeenCalled();
        expect(transcribe.transcriberLoaded()).toBe(true);

        await vi.advanceTimersByTimeAsync(transcribe.MODEL_IDLE_MS);

        expect(terminate).toHaveBeenCalledTimes(1);
        expect(transcribe.transcriberLoaded()).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("loads the model again for the next message", async () => {
        await transcribe.transcribe(new ArrayBuffer(8));
        await vi.advanceTimersByTimeAsync(transcribe.MODEL_IDLE_MS);

        expect(await transcribe.transcribe(new ArrayBuffer(8))).toBe("hello there");
        expect(made).toHaveLength(2);
    });

    it("keeps the model while messages keep being transcribed", async () => {
        for (let i = 0; i < 10; i++) {
            await transcribe.transcribe(new ArrayBuffer(8));
            await vi.advanceTimersByTimeAsync(transcribe.MODEL_IDLE_MS - 1);
        }

        expect(made).toHaveLength(1);
        expect(terminate).not.toHaveBeenCalled();
    });

    it("does not let the model go under a transcript that is still being worked out", async () => {
        const working = Promise.withResolvers<{ text: string }>();
        run.mockReturnValue(working.promise);

        const slow = transcribe.transcribe(new ArrayBuffer(8));
        await vi.advanceTimersByTimeAsync(transcribe.MODEL_IDLE_MS * 3);
        expect(terminate).not.toHaveBeenCalled();

        working.resolve({ text: "late" });
        expect(await slow).toBe("late");
        await vi.advanceTimersByTimeAsync(transcribe.MODEL_IDLE_MS);
        expect(terminate).toHaveBeenCalledTimes(1);
    });

    it("gives nothing back, and asks again next time, when the model could not be loaded", async () => {
        run.mockRejectedValueOnce(new Error("offline"));
        expect(await transcribe.transcribe(new ArrayBuffer(8))).toBeUndefined();

        expect(await transcribe.transcribe(new ArrayBuffer(8))).toBe("hello there");
    });

    it("hands the language hint to the worker", async () => {
        await transcribe.transcribe(new ArrayBuffer(8), "pl");
        expect(run).toHaveBeenCalledWith(expect.any(Float32Array), "pl", expect.any(Array));
    });

    it("limits a guessed language to the browser's languages and English", async () => {
        vi.stubGlobal("navigator", { languages: ["pl-PL", "de", "en-GB"] });
        await transcribe.transcribe(new ArrayBuffer(8));

        const among = run.mock.calls[0][2] as string[];
        expect(among).toEqual(expect.arrayContaining(["pl", "de", "en"]));
        expect(new Set(among).size).toBe(among.length);
    });

    it("always allows English, and nothing the user has not set", () => {
        vi.stubGlobal("navigator", { languages: ["ro"] });
        expect(transcribe.likelyLanguages()).toContain("en");
        expect(transcribe.likelyLanguages()).toContain("ro");
        expect(transcribe.likelyLanguages()).not.toContain("pl");
    });

    it("starts a new worker after the worker died", async () => {
        await transcribe.transcribe(new ArrayBuffer(8));
        const [first] = made as FakeWorker[];
        first.onerror?.({ message: "out of memory" });
        expect(transcribe.transcriberLoaded()).toBe(false);

        await transcribe.transcribe(new ArrayBuffer(8));
        expect(made).toHaveLength(2);
    });
});
