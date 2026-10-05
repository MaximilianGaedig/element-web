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
/** The settings transformers.js starts with in a browser: the runtime from a CDN, through its cache. */
const env = {
    useWasmCache: true,
    backends: { onnx: { wasm: { wasmPaths: {} as unknown } } },
};

vi.mock("@huggingface/transformers", () => ({ pipeline, env }));

describe("transcribing a voice message", () => {
    let transcribe: typeof import("./transcribe");

    beforeEach(async () => {
        vi.useFakeTimers();
        // The model is module state: a fresh module is a fresh session.
        vi.resetModules();
        run.mockReset().mockResolvedValue({ text: " hello there " });
        dispose.mockReset().mockResolvedValue(undefined);
        pipeline.mockReset().mockImplementation(async () => Object.assign(run, { dispose }));
        env.useWasmCache = true;
        env.backends.onnx.wasm.wasmPaths = {
            mjs: "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs",
            wasm: "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm",
        };

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

    // The app's content policy runs scripts from this origin only: the runtime from a CDN, or from the
    // `blob:` URL transformers.js's cache makes of it, failed every transcript.
    it("runs the model on the runtime served with the app, imported from its own URL", async () => {
        let settings: unknown;
        pipeline.mockImplementation(async () => {
            settings = structuredClone(env);
            return Object.assign(run, { dispose });
        });

        expect(await transcribe.transcribe(new ArrayBuffer(8))).toBe("hello there");

        expect(transcribe.RUNTIME_FILES.mjs).toMatch(/\/ort-wasm-simd-threaded\.asyncify\.mjs$/);
        expect(transcribe.RUNTIME_FILES.wasm).toMatch(/\/ort-wasm-simd-threaded\.asyncify\.wasm$/);
        expect(settings).toEqual({
            useWasmCache: false,
            backends: { onnx: { wasm: { wasmPaths: transcribe.RUNTIME_FILES } } },
        });
    });

    describe("on a device with a GPU", () => {
        const withGpu = (features: string[]): void => {
            Object.defineProperty(navigator, "gpu", {
                configurable: true,
                value: { requestAdapter: async () => ({ features: new Set(features) }) },
            });
        };
        afterEach(() => {
            delete (navigator as { gpu?: unknown }).gpu;
        });

        it("runs the half-precision model on it", async () => {
            withGpu(["shader-f16"]);
            await transcribe.transcribe(new ArrayBuffer(8));
            expect(pipeline).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
                device: "webgpu",
                dtype: "fp16",
            });
        });

        // Asked to, the runtime refused to load the model at all ("does not support fp16").
        it("runs on the CPU where the GPU has no half precision", async () => {
            withGpu([]);
            await transcribe.transcribe(new ArrayBuffer(8));
            expect(pipeline).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
                device: "wasm",
                dtype: "q8",
            });
        });
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
