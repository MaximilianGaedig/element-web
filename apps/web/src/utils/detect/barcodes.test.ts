/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    BARCODES_KEPT,
    barcodeReaderRunning,
    barcodeResultsKept,
    READER_IDLE_MS,
    readBarcodes,
    readBarcodesForEvent,
} from "./barcodes";
import barcodeWorkerFactory from "../../workers/barcodeWorkerFactory";

vi.mock("../../workers/barcodeWorkerFactory", () => ({ default: vi.fn() }));

describe("reading the codes in pictures", () => {
    const detect = vi.fn();

    beforeEach(() => {
        detect.mockReset().mockResolvedValue([]);
        vi.stubGlobal(
            "BarcodeDetector",
            class {
                public detect = detect;
            },
        );
        vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ close: vi.fn() }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("reads a picture once per event", async () => {
        await readBarcodesForEvent("$once", new Blob(["picture"]));
        await readBarcodesForEvent("$once", new Blob(["picture"]));

        expect(detect).toHaveBeenCalledTimes(1);
    });

    it("keeps what it found for the pictures seen lately, not for every picture of the session", async () => {
        for (let i = 0; i < BARCODES_KEPT * 3; i++) await readBarcodesForEvent(`$event${i}`, new Blob(["picture"]));

        expect(barcodeResultsKept()).toBe(BARCODES_KEPT);
    });

    // Brave on Linux and Safari have no reader of their own: zxing's runs, in a worker that is ended when idle.
    describe("where the browser has no reader", () => {
        let terminate: ReturnType<typeof vi.fn>;
        const posted: unknown[] = [];

        beforeEach(() => {
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
            vi.stubGlobal("BarcodeDetector", undefined);
            posted.length = 0;
            terminate = vi.fn();
            vi.mocked(barcodeWorkerFactory)
                .mockReset()
                .mockImplementation(() => {
                    const worker = {
                        onmessage: null as ((ev: MessageEvent) => void) | null,
                        terminate,
                        postMessage(message: { seq: number }) {
                            posted.push(message);
                            // A QR code at 10,20, 30 wide and 40 high, in a 100x200 picture
                            queueMicrotask(() =>
                                worker.onmessage?.({
                                    data: {
                                        seq: message.seq,
                                        codes: [
                                            {
                                                text: "https://example.org",
                                                format: "qr_code",
                                                x: 10,
                                                y: 20,
                                                width: 30,
                                                height: 40,
                                            },
                                        ],
                                    },
                                } as MessageEvent),
                            );
                        },
                    };
                    return worker as unknown as Worker;
                });
        });

        afterEach(() => {
            // Each test starts with no reader running
            vi.advanceTimersByTime(READER_IDLE_MS);
            vi.useRealTimers();
        });

        it("reads with zxing in a worker, never on the page", async () => {
            const found = await readBarcodes(new Blob(["picture"]), { width: 100, height: 200 });

            expect(found).toEqual([
                { text: "https://example.org", format: "qr_code", left: 0.1, top: 0.1, width: 0.3, height: 0.2 },
            ]);
            expect(posted).toHaveLength(1);
        });

        it("ends the worker, and its memory, a while after the last read", async () => {
            await readBarcodes(new Blob(["one"]));
            await readBarcodes(new Blob(["two"]));
            expect(barcodeWorkerFactory).toHaveBeenCalledTimes(1);
            expect(barcodeReaderRunning()).toBe(true);

            vi.advanceTimersByTime(READER_IDLE_MS - 1);
            expect(terminate).not.toHaveBeenCalled();
            vi.advanceTimersByTime(1);
            expect(terminate).toHaveBeenCalledTimes(1);
            expect(barcodeReaderRunning()).toBe(false);

            // and the next picture starts a new one
            await readBarcodes(new Blob(["three"]));
            expect(barcodeWorkerFactory).toHaveBeenCalledTimes(2);
        });
    });
});
