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
 * One worker is kept while pictures are being read, because starting it is most of the cost of a short
 * read - and stopped once they stop coming (see ENGINE_IDLE_MS), because what it holds is not small.
 */

import { logger } from "matrix-js-sdk/src/logger";

import type { createWorker as CreateWorker, Page } from "tesseract.js";
import { LruCache } from "../LruCache";

/**
 * Whether to say out loud what every reading does (`?ocr` in the address).
 *
 * Reading a picture is the kind of feature that fails into silence: nothing on screen tells a picture
 * that could not be read from one with nothing in it, so a broken engine looks exactly like a holiday
 * photograph. This turns the whole path into console output, which is the difference between debugging
 * it and guessing at it.
 */
const LOUD = typeof window !== "undefined" && window.location.search.includes("ocr");
const say = (...what: unknown[]): void => {
    if (LOUD) logger.info("[ocr]", ...what);
};

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

/**
 * How long the engine is kept after the last picture was read.
 *
 * The engine is WebAssembly, and WebAssembly memory only ever grows: the worker's heap stays at whatever
 * the largest photograph it has read needed - tens of megabytes for a phone's camera picture, on top of
 * the engine and its language data - until the worker itself is gone. Kept for the session, that was
 * memory held from the first picture of the morning until the tab was closed.
 *
 * A minute covers reading through a chat (pictures arrive seconds apart, one at a time) so the engine
 * is started once per burst rather than once per picture; starting it again afterwards costs a few
 * hundred milliseconds from the service worker's cache, before a read that takes longer than that.
 */
export const ENGINE_IDLE_MS = 60_000;

let createWorker: typeof CreateWorker;
let worker: Promise<Worker> | undefined;
/** Reads that hold the engine: it is not stopped under any of them. */
let reading = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

/** Stops the engine and gives its memory back. The next read starts a new one. */
function stopWorker(): void {
    idleTimer = undefined;
    const stopping = worker;
    worker = undefined;
    void stopping?.then((engine) => engine.terminate()).catch(() => {});
}

/** Whether the engine is running, for the memory report. */
export function ocrEngineRunning(): boolean {
    return worker !== undefined;
}

/** Holds the engine for one read; the returned function lets go and starts the idle clock. */
function holdWorker(): () => void {
    reading++;
    clearTimeout(idleTimer);
    idleTimer = undefined;
    return () => {
        if (--reading > 0) return;
        clearTimeout(idleTimer);
        idleTimer = setTimeout(stopWorker, ENGINE_IDLE_MS);
    };
}

/** The one worker, started on the first read and kept until reading stops. */
async function getWorker(): Promise<Worker> {
    const starting = (worker ??= (async () => {
        // Imported here, not at the top: none of this belongs on the startup path.
        say("starting the engine");
        ({ createWorker } = await import("tesseract.js"));
        // Absolute, every one of them. The engine runs in a worker made from a blob, and inside such a
        // worker a relative path resolves against the blob's own URL - "ocr/..." becomes
        // "blob:https://host/ocr/...", which cannot be fetched and fails where nobody is looking.
        const here = (file: string): string => new URL(file, document.baseURI).href;
        return createWorker("eng", undefined, {
            corePath: here("ocr/"),
            langPath: here("ocr/"),
            // Its worker too. Left to itself the library reaches for a copy on a CDN, which is both a
            // thing to fetch before a picture can be read offline and, if it is ever loaded directly,
            // a worker from another origin - which no browser allows. Everything it needs is here.
            workerPath: here("ocr/worker.min.js"),
            // The data is served compressed and cached; the library must not reach for the CDN copy.
            gzip: true,
            logger: () => {},
        });
    })());
    // An engine that could not start is not the engine: without this the failure is what every later
    // read is handed, and nothing is read again until the page is reloaded.
    starting.catch(() => {
        if (worker === starting) worker = undefined;
    });
    return starting;
}

/**
 * The text in an image, or undefined when there is none worth offering.
 *
 * A picture of a face returns nothing rather than the letters the engine thought it saw in the eyes:
 * an empty result is far better than a confident wrong one, since everything downstream - links,
 * dates, search - takes what this says at face value.
 */
export async function readImage(source: Blob | string, size?: ImageSize): Promise<OcrResult | undefined> {
    const letGo = holdWorker();
    try {
        const tesseract = await getWorker();
        // The event usually says how big the picture is, but not always - a sticker, a bridged photo
        // with no info block - and without a size the words have nowhere to go. The picture itself
        // always knows, so ask it rather than skipping the picture.
        size ??= await sizeOf(source);
        // Blocks carry the word geometry the overlay needs; without them only the text comes back.
        say("reading", size ?? "(size unknown)");
        const { data } = await tesseract.recognize(source, undefined, { blocks: true, text: true });
        const text = data.text.trim();
        say("read", { confidence: Math.round(data.confidence), chars: text.length });
        if (!text || data.confidence < MIN_CONFIDENCE) {
            say("nothing worth keeping: below the confidence bar, or no words at all");
            return undefined;
        }
        return { text, confidence: data.confidence, words: size ? wordsOf(data, size) : [] };
    } catch (error) {
        // Loudly: a reading that fails silently is indistinguishable from a picture with nothing in it,
        // which is exactly how this went unnoticed once already.
        logger.warn("Could not read the text in an image", error);
        return undefined;
    } finally {
        letGo();
    }
}

/** The picture's own size, measured from the picture, for an event that does not say. */
async function sizeOf(source: Blob | string): Promise<ImageSize | undefined> {
    try {
        const blob = typeof source === "string" ? await fetch(source).then((r) => r.blob()) : source;
        const bitmap = await createImageBitmap(blob);
        try {
            return { width: bitmap.width, height: bitmap.height };
        } finally {
            bitmap.close();
        }
    } catch {
        // Then the words are read but not placed, which is still worth having: they can be searched.
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
 * result is the same every time, so it is kept. Promises are cached rather than results, so two things
 * asking at once wait for one read.
 *
 * Kept for the pictures seen lately rather than for all of them: a screenshot full of text is a few
 * hundred words, each with its place, which is tens of kilobytes - and a day of reading chats is
 * thousands of pictures. 300 is more pictures than the chats kept open hold between them, so going
 * back to one reads nothing twice; a picture from further back than that is simply read again.
 */
export const RESULTS_KEPT = 300;
const cache = new LruCache<string, Promise<OcrResult | undefined>>(RESULTS_KEPT);

/** How many pictures' readings are held, for the memory report. */
export function ocrResultsKept(): number {
    return cache.size;
}

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
