/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const recognize = vi.fn();
const terminate = vi.fn();
const createWorker = vi.fn();

vi.mock("tesseract.js", () => ({ createWorker }));

const SIZE = { width: 100, height: 100 };
const picture = (): Blob => new Blob(["picture"]);

describe("reading the text in pictures", () => {
    let ocr: typeof import("./ocr");

    beforeEach(async () => {
        vi.useFakeTimers();
        // The engine and what it has read are module state: a fresh module is a fresh session.
        vi.resetModules();
        recognize.mockReset().mockResolvedValue({ data: { text: "hello", confidence: 90, blocks: [] } });
        terminate.mockReset().mockResolvedValue(undefined);
        createWorker.mockReset().mockImplementation(async () => ({ recognize, terminate }));
        ocr = await import("./ocr");
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe("the engine", () => {
        // Its memory is WebAssembly's, which only ever grows: after one large photograph the worker
        // holds that much for as long as it lives, and it used to live for the whole session.
        it("is stopped once nothing has been read for a while", async () => {
            await ocr.readImage(picture(), SIZE);
            expect(createWorker).toHaveBeenCalledTimes(1);
            expect(terminate).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(ocr.ENGINE_IDLE_MS);

            expect(terminate).toHaveBeenCalledTimes(1);
            expect(vi.getTimerCount()).toBe(0);
        });

        it("is started again for the next picture", async () => {
            await ocr.readImage(picture(), SIZE);
            await vi.advanceTimersByTimeAsync(ocr.ENGINE_IDLE_MS);

            expect(await ocr.readImage(picture(), SIZE)).toEqual({ text: "hello", confidence: 90, words: [] });
            expect(createWorker).toHaveBeenCalledTimes(2);
        });

        it("is kept while pictures keep coming", async () => {
            for (let i = 0; i < 20; i++) {
                await ocr.readImage(picture(), SIZE);
                await vi.advanceTimersByTimeAsync(ocr.ENGINE_IDLE_MS - 1);
            }

            expect(createWorker).toHaveBeenCalledTimes(1);
            expect(terminate).not.toHaveBeenCalled();
        });

        it("is not stopped under a read that is still going", async () => {
            const reading = Promise.withResolvers<{ data: { text: string; confidence: number; blocks: [] } }>();
            await ocr.readImage(picture(), SIZE);
            recognize.mockReturnValue(reading.promise);

            const slow = ocr.readImage(picture(), SIZE);
            await vi.advanceTimersByTimeAsync(ocr.ENGINE_IDLE_MS * 3);
            expect(terminate).not.toHaveBeenCalled();

            reading.resolve({ data: { text: "late", confidence: 90, blocks: [] } });
            expect((await slow)?.text).toBe("late");
            await vi.advanceTimersByTimeAsync(ocr.ENGINE_IDLE_MS);
            expect(terminate).toHaveBeenCalledTimes(1);
        });

        it("is tried again after it failed to start", async () => {
            createWorker.mockRejectedValueOnce(new Error("no engine"));
            expect(await ocr.readImage(picture(), SIZE)).toBeUndefined();

            expect((await ocr.readImage(picture(), SIZE))?.text).toBe("hello");
            expect(createWorker).toHaveBeenCalledTimes(2);
        });
    });

    describe("what was read", () => {
        it("is read once per event", async () => {
            const first = await ocr.readImageForEvent("$one", async () => picture(), SIZE);
            const again = await ocr.readImageForEvent("$one", async () => picture(), SIZE);

            expect(again).toBe(first);
            expect(recognize).toHaveBeenCalledTimes(1);
        });

        it("is kept for the pictures seen lately, not for every picture of the session", async () => {
            const seen = ocr.RESULTS_KEPT * 4;
            for (let i = 0; i < seen; i++) await ocr.readImageForEvent(`$event${i}`, async () => picture(), SIZE);

            expect(ocr.ocrResultsKept()).toBe(ocr.RESULTS_KEPT);
            // The latest are the ones still held.
            await ocr.readImageForEvent(`$event${seen - 1}`, async () => picture(), SIZE);
            expect(recognize).toHaveBeenCalledTimes(seen);
        });
    });
});
