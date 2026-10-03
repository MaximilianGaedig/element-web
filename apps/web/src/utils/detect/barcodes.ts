/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The codes in a picture: a QR code on a poster, a ticket's barcode, the square somebody photographed
 * off a screen to share a Wi-Fi network.
 *
 * Two readers, because neither is available everywhere. Chromium has one built into the browser, which
 * costs nothing to use and is what runs on the desktop. Safari - so the phone, where a photographed QR
 * code is most likely to turn up - has none, so a reader is loaded there: zxing's, as WebAssembly served
 * from this origin like the text engine, so it works offline and nothing about the picture leaves the
 * device. It is loaded the first time a picture is read on such a browser and not before, in a worker
 * that is ended a minute after the last read (READER_IDLE_MS): its memory grows to fit the largest
 * picture and never shrinks, and on the page it held ~21 MB for the rest of the session. Brave on Linux
 * has no reader of its own either, so the desktop paid for it too.
 *
 * What a code says is turned into something to do - open the link, join the network, copy the number -
 * by `actionOf`, and never acted on by itself.
 */

import { logger } from "matrix-js-sdk/src/logger";

import { LruCache } from "../LruCache";
import { WorkerManager } from "../../WorkerManager";
import type { Request, Response } from "../../workers/barcode.worker";

/** A code found in a picture, and where it sits, as a fraction of the picture's own size. */
export interface FoundBarcode {
    /** What it says, verbatim. */
    text: string;
    /** `qr_code`, `ean_13`, … as the readers name them. */
    format: string;
    left: number;
    top: number;
    width: number;
    height: number;
}

interface DetectedBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface NativeBarcode {
    rawValue: string;
    format: string;
    boundingBox: DetectedBox;
}

interface NativeDetector {
    detect(source: ImageBitmapSource): Promise<NativeBarcode[]>;
}

/** The browser's own reader, where there is one. */
const nativeDetector = (): NativeDetector | undefined => {
    const Detector = (globalThis as { BarcodeDetector?: new (options?: object) => NativeDetector }).BarcodeDetector;
    return Detector ? new Detector() : undefined;
};

/** How long zxing's worker is kept after the last read: a chat's pictures arrive seconds apart. */
export const READER_IDLE_MS = 60_000;

let reader: { worker: Worker; manager: WorkerManager<Request, Response> } | undefined;
let reading = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

/** Whether zxing's reader is running, for the memory report. */
export function barcodeReaderRunning(): boolean {
    return reader !== undefined;
}

/** zxing's reader, in its worker, for one read; it is ended once reads have stopped for a while. */
async function readWithZxing(picture: Blob): Promise<NonNullable<Response["codes"]>> {
    reading++;
    clearTimeout(idleTimer);
    try {
        if (!reader) {
            const { default: factory } = await import("../../workers/barcodeWorkerFactory");
            const worker = factory();
            reader = { worker, manager: new WorkerManager<Request, Response>(worker) };
        }
        const { codes, error } = await reader.manager.call({ picture, base: document.baseURI });
        if (error) throw new Error(error);
        return codes ?? [];
    } finally {
        if (--reading === 0) {
            idleTimer = setTimeout(() => {
                reader?.worker.terminate();
                reader = undefined;
            }, READER_IDLE_MS);
        }
    }
}

/**
 * The codes in a picture.
 *
 * `size` is the picture's own pixel size, which is what the boxes come back in; without it the codes
 * are still read but have nowhere to be drawn, so they are returned with no place.
 */
export async function readBarcodes(
    source: Blob | string,
    size?: { width: number; height: number },
): Promise<FoundBarcode[]> {
    const picture = typeof source === "string" ? await fetch(source).then((r) => r.blob()) : source;
    const place = (box: DetectedBox): Omit<FoundBarcode, "text" | "format"> => ({
        left: size ? box.x / size.width : 0,
        top: size ? box.y / size.height : 0,
        width: size ? box.width / size.width : 0,
        height: size ? box.height / size.height : 0,
    });

    try {
        const native = nativeDetector();
        if (native) {
            const bitmap = await createImageBitmap(picture);
            try {
                const found = await native.detect(bitmap);
                return found.map((code) => ({
                    text: code.rawValue,
                    format: code.format,
                    ...place(code.boundingBox),
                }));
            } finally {
                bitmap.close();
            }
        }

        const found = await readWithZxing(picture);
        return found.map(({ text, format, ...box }) => ({ text, format, ...place(box) }));
    } catch (error) {
        logger.warn("Could not read the codes in an image", error);
        return [];
    }
}

/*
 * What has already been read, by event: the same pictures come back every time a chat is opened and a
 * code says the same thing every time.
 *
 * For the pictures seen lately, not all of them: every picture that comes into view is read, so a map
 * of everything is a map that grows all day. An entry is small (most pictures hold no code at all), so
 * a thousand of them cost little and cover any going back and forth between chats.
 */
export const BARCODES_KEPT = 1000;
const cache = new LruCache<string, Promise<FoundBarcode[]>>(BARCODES_KEPT);

/** How many pictures' codes are held, for the memory report. */
export function barcodeResultsKept(): number {
    return cache.size;
}

/** The codes in an event's picture, read once. */
export function readBarcodesForEvent(
    eventId: string,
    source: Blob | string,
    size?: { width: number; height: number },
): Promise<FoundBarcode[]> {
    const existing = cache.get(eventId);
    if (existing) return existing;
    const reading = readBarcodes(source, size);
    cache.set(eventId, reading);
    return reading;
}

/** What a code is offering, and what to do about it. */
export interface BarcodeAction {
    /** What to show: the network's name, the link's host, the number itself. */
    label: string;
    /** Somewhere to go, where the code names somewhere. */
    href?: string;
    /** What to copy, where there is nowhere to go: a Wi-Fi password, a ticket number. */
    copy?: string;
}

const WIFI = /^WIFI:(?<fields>.*)$/i;
const MAILTO = /^(?:mailto:|MATMSG:TO:)/i;
const TEL = /^tel:/i;

/** Reads a `WIFI:S:name;T:WPA;P:secret;;` code into its parts. */
function wifiFields(text: string): Record<string, string> {
    const fields: Record<string, string> = {};
    for (const part of text.replace(WIFI, "$<fields>").split(";")) {
        const [key, ...rest] = part.split(":");
        if (key && rest.length) fields[key.toUpperCase()] = rest.join(":");
    }
    return fields;
}

/**
 * What to offer for a code.
 *
 * A network is offered as its name and its password to copy, because a browser cannot join a network
 * and pretending otherwise would be worse than saying what it says.
 */
export function actionOf(code: FoundBarcode): BarcodeAction {
    const text = code.text.trim();
    if (WIFI.test(text)) {
        const fields = wifiFields(text);
        return { label: fields.S ?? text, copy: fields.P };
    }
    if (/^https?:\/\//i.test(text)) {
        try {
            return { label: new URL(text).host, href: text };
        } catch {
            return { label: text, copy: text };
        }
    }
    if (MAILTO.test(text) || TEL.test(text)) return { label: text.replace(MAILTO, ""), href: text };
    return { label: text, copy: text };
}
