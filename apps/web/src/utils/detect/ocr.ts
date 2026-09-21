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
import type { createWorker as CreateWorker, Page } from "tesseract.js";

/** One word, and where it sits in the picture, as a fraction of the picture's own size. */
export interface OcrWord {
    text: string;
    /** 0-1 of the width and height, so the overlay follows the picture at whatever size it is drawn. */
    left: number;
    top: number;
    width: number;
    height: number;
}

/** What a picture said, and how sure the engine was of it. */
export interface OcrResult {
    text: string;
    /** 0-100, the engine's own mean confidence: low means it read noise rather than words. */
    confidence: number;
    /** The words with their places, for laying selectable text over the picture. */
    words: OcrWord[];
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

/**
 * The text in an image, or undefined when there is none worth offering.
 *
 * A picture of a face returns nothing rather than the letters the engine thought it saw in the eyes:
 * an empty result is far better than a confident wrong one, since everything downstream - links,
 * dates, search - takes what this says at face value.
 */
export async function readImage(source: Blob | string, size?: ImageSize): Promise<OcrResult | undefined> {
    try {
        const tesseract = await getWorker();
        // Blocks carry the word geometry the overlay needs; without them only the text comes back.
        const { data } = await tesseract.recognize(source, undefined, { blocks: true, text: true });
        const text = data.text.trim();
        if (!text || data.confidence < MIN_CONFIDENCE) return undefined;
        return { text, confidence: data.confidence, words: size ? wordsOf(data, size) : [] };
    } catch (error) {
        logger.warn("Could not read the text in an image", error);
        return undefined;
    }
}

/** The picture's own pixel size. The engine reports word boxes in it, and does not report it back. */
export interface ImageSize {
    width: number;
    height: number;
}

/**
 * The words as fractions of the picture, which is what an overlay over a scaled one needs.
 *
 * The engine gives boxes in the picture's own pixels but never says how big it was, so the caller has
 * to; without that the words are left out rather than laid somewhere wrong.
 */
function wordsOf(page: Page, { width, height }: ImageSize): OcrWord[] {
    const words: OcrWord[] = [];
    for (const block of page.blocks ?? []) {
        for (const paragraph of block.paragraphs) {
            for (const line of paragraph.lines) {
                for (const word of line.words) {
                    if (word.confidence < MIN_CONFIDENCE) continue;
                    words.push({
                        text: word.text,
                        left: word.bbox.x0 / width,
                        top: word.bbox.y0 / height,
                        width: (word.bbox.x1 - word.bbox.x0) / width,
                        height: (word.bbox.y1 - word.bbox.y0) / height,
                    });
                }
            }
        }
    }
    return words;
}

/*
 * What has already been read, by event.
 *
 * Reading a picture costs real work, and the same pictures come back every time a chat is opened; a
 * result is the same every time, so it is kept for the session. Promises are cached rather than
 * results, so two things asking at once wait for one read.
 */
const cache = new Map<string, Promise<OcrResult | undefined>>();

/** Reads a picture, or returns what an earlier read of the same event already found. */
export function readImageForEvent(
    eventId: string,
    source: () => Promise<Blob | string>,
    size?: ImageSize,
): Promise<OcrResult | undefined> {
    const existing = cache.get(eventId);
    if (existing) return existing;
    const reading = queued(async () => readImage(await source(), size));
    cache.set(eventId, reading);
    return reading;
}

/*
 * One picture at a time.
 *
 * The engine is a worker with one thread; asking it to read a screenful of pictures at once would
 * make each of them slower and leave the device warm for no reason.
 */
let queue: Promise<unknown> = Promise.resolve();

function queued<T>(work: () => Promise<T>): Promise<T> {
    const result = queue.then(work, work);
    queue = result.catch(() => {});
    return result;
}
