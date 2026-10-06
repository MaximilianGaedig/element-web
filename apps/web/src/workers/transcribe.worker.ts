/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Whisper, off the main thread (see utils/detect/transcribe.ts for what it is for and why).
 *
 * Running the model - on the CPU especially - holds a thread for seconds, and on the page's own thread
 * that is the whole app: typing, scrolling and playback all stop until it is done. Here it only holds
 * this worker. The page terminates the worker once the model has been idle, which gives back the model's
 * memory in one go.
 */

import { pipeline } from "@huggingface/transformers";

/** Small enough to fetch on a phone, good enough to trust with a name or a number. */
const MODEL = "onnx-community/whisper-base";

export interface Request {
    seq: number;
    /** Mono, 16 kHz samples. */
    samples: Float32Array;
    language?: string;
}

export type Response = { seq: number; text: string } | { seq: number; error: string };

type Transcriber = (audio: Float32Array, options?: object) => Promise<{ text: string } | Array<{ text: string }>>;

const ctx: Worker = self as any;

let transcriber: Promise<Transcriber> | undefined;

/** Whether the device has a GPU to do this on, which decides how long it takes rather than whether. */
async function bestDevice(): Promise<"webgpu" | "wasm"> {
    const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (!gpu) return "wasm";
    try {
        return (await gpu.requestAdapter()) ? "webgpu" : "wasm";
    } catch {
        return "wasm";
    }
}

/** The one engine of this worker: loading it is most of the cost of a short transcript. */
function getTranscriber(): Promise<Transcriber> {
    const loading = (transcriber ??= (async () => {
        const device = await bestDevice();
        return await pipeline("automatic-speech-recognition", MODEL, {
            // Quantised: a quarter of the size, and no worse at speech at this size.
            dtype: device === "webgpu" ? "fp16" : "q8",
            device,
        });
    })());
    // A model that could not be fetched (offline, the first time) is not the model: without this the
    // failure is what every later request is handed until the worker is replaced.
    loading.catch(() => {
        if (transcriber === loading) transcriber = undefined;
    });
    return loading;
}

ctx.addEventListener("message", async (event: MessageEvent<Request>): Promise<void> => {
    const { seq, samples, language } = event.data;
    try {
        const engine = await getTranscriber();
        const result = await engine(samples, {
            // Long audio in half-minute pieces with a little overlap, which is how whisper is meant to
            // be given anything longer than it can hold at once.
            chunk_length_s: 30,
            stride_length_s: 5,
            ...(language ? { language } : {}),
        });
        const text = (Array.isArray(result) ? result.map((part) => part.text).join(" ") : result.text).trim();
        ctx.postMessage({ seq, text } satisfies Response);
    } catch (error) {
        ctx.postMessage({ seq, error: String((error as Error)?.message ?? error) } satisfies Response);
    }
});
