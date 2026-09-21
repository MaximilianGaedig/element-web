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
 * device. It is loaded the first time a picture is read on such a browser and not before.
 *
 * What a code says is turned into something to do - open the link, join the network, copy the number -
 * by `actionOf`, and never acted on by itself.
 */

import { logger } from "matrix-js-sdk/src/logger";
import type * as ZXing from "zxing-wasm/reader";

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

let zxing: Promise<typeof ZXing> | undefined;

/** zxing's reader, from this origin, loaded once and kept. */
async function getZxing(): Promise<typeof ZXing> {
    zxing ??= (async () => {
        const module = await import("zxing-wasm/reader");
        module.prepareZXingModule({
            // Served by us (see the `barcode` pattern in webpack.config.ts), not fetched from a CDN:
            // the app works offline, and a picture is nobody else's business.
            // Absolute for the same reason the text engine's paths are: a relative one resolves against
            // whatever the loader's own URL happens to be.
            overrides: { locateFile: (file: string) => new URL(`barcode/${file}`, document.baseURI).href },
        });
        return module;
    })();
    return zxing;
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

        const { readBarcodes: read } = await getZxing();
        const found = await read(picture, { tryHarder: true });
        return found
            .filter((code) => code.isValid && code.text)
            .map((code) => {
                const { topLeft, bottomRight } = code.position;
                return {
                    text: code.text,
                    format: code.format.toLowerCase(),
                    ...place({
                        x: topLeft.x,
                        y: topLeft.y,
                        width: bottomRight.x - topLeft.x,
                        height: bottomRight.y - topLeft.y,
                    }),
                };
            });
    } catch (error) {
        logger.warn("Could not read the codes in an image", error);
        return [];
    }
}

/*
 * What has already been read, by event: the same pictures come back every time a chat is opened and a
 * code says the same thing every time.
 */
const cache = new Map<string, Promise<FoundBarcode[]>>();

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
