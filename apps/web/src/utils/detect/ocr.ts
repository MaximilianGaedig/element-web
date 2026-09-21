/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Reading the text in a picture, on the device.
 *
 * Tesseract runs in a worker here, against its engine and language data served from this origin (see the
 * `ocr` patterns in webpack.config.ts) rather than the CDN the library reaches for by default. That
 * matters twice over: the app is meant to work offline, and nothing about a picture - including the fact
 * that one was read at all - should leave the device.
 *
 * The engine and the language data together are several megabytes, so nothing is loaded until someone
 * asks to read a picture; from then on the service worker has them and the second read is immediate.
 * One worker is kept for the session, because starting it is most of the cost of a short read.
 */

import { logger } from "matrix-js-sdk/src/logger";
import type { createWorker as CreateWorker } from "tesseract.js";

/** What a picture said, and how sure the engine was of it. */
export interface OcrResult {
    text: string;
    /** 0-100, the engine's own mean confidence: low means it read noise rather than words. */
    confidence: number;
}

/** Below this the engine is guessing at texture rather than reading letters. */
const MIN_CONFIDENCE = 40;

type Worker = Awaited<ReturnType<typeof CreateWorker>>;

let createWorker: typeof CreateWorker;
let worker: Promise<Worker> | undefined;

/** The one worker for this session, started on the first read and kept for the rest. */
async function getWorker(): Promise<Worker> {
    worker ??= (async () => {
        // Imported here, not at the top: none of this belongs on the startup path.
        ({ createWorker } = await import("tesseract.js"));
        return createWorker("eng", undefined, {
            corePath: "ocr/",
            langPath: "ocr/",
            // The data is served compressed and cached; the library must not reach for the CDN copy.
            gzip: true,
            logger: () => {},
        });
    })();
    return worker;
}

/** Stops the worker and forgets it, so its memory goes back when the session is done reading. */
export async function stopOcr(): Promise<void> {
    const running = worker;
    worker = undefined;
    await running?.then((w) => w.terminate()).catch(() => {});
}

/**
 * The text in an image, or undefined when there is none worth offering.
 *
 * A picture of a face returns nothing rather than the letters the engine thought it saw in the eyes:
 * an empty result is far better than a confident wrong one, since everything downstream - links,
 * dates, search - takes what this says at face value.
 */
export async function readImage(source: Blob | string): Promise<OcrResult | undefined> {
    try {
        const tesseract = await getWorker();
        const { data } = await tesseract.recognize(source);
        const text = data.text.trim();
        if (!text || data.confidence < MIN_CONFIDENCE) return undefined;
        return { text, confidence: data.confidence };
    } catch (error) {
        logger.warn("Could not read the text in an image", error);
        return undefined;
    }
}
