/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * zxing's barcode reader, in a worker of its own (see utils/detect/barcodes.ts).
 *
 * Its WebAssembly memory grows to fit the largest picture it has read and can never shrink: on the page
 * it held ~21 MB from the first picture until the tab was closed. Here it goes when the worker is ended.
 */

import type * as ZXing from "zxing-wasm/reader";

import { type WorkerPayload } from "./worker";

const ctx: Worker = self as any;

export interface Request {
    picture: Blob;
    /** Where the app is served from, for the reader's .wasm file: a worker has no document to resolve against. */
    base: string;
}

export interface FoundCode {
    text: string;
    format: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface Response {
    codes?: FoundCode[];
    error?: string;
}

let zxing: Promise<typeof ZXing> | undefined;

function reader(base: string): Promise<typeof ZXing> {
    zxing ??= import("zxing-wasm/reader").then((module) => {
        // Served by us (the `barcode` pattern in webpack.config.ts): the app works offline, and a picture
        // is nobody else's business.
        module.prepareZXingModule({
            overrides: { locateFile: (file: string) => new URL(`barcode/${file}`, base).href },
        });
        return module;
    });
    return zxing;
}

ctx.addEventListener("message", (event: MessageEvent<Request & WorkerPayload>): void => {
    const { seq, picture, base } = event.data;
    reader(base)
        .then((module) => module.readBarcodes(picture, { tryHarder: true }))
        .then((found) => {
            const codes = found
                .filter((code) => code.isValid && code.text)
                .map((code) => {
                    const { topLeft, bottomRight } = code.position;
                    return {
                        text: code.text,
                        format: code.format.toLowerCase(),
                        x: topLeft.x,
                        y: topLeft.y,
                        width: bottomRight.x - topLeft.x,
                        height: bottomRight.y - topLeft.y,
                    };
                });
            ctx.postMessage({ seq, codes });
        })
        .catch((error: unknown) => ctx.postMessage({ seq, error: String(error) }));
});
