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

import { pipeline, Tensor } from "@huggingface/transformers";

import { detectLanguage, type LanguageDetector } from "../utils/detect/whisperLanguage";

/**
 * Small rather than base: base turned a Polish voice message into nonsense, small reads it. About a
 * quarter of a gigabyte to fetch once (the browser keeps it), and it is let go again when idle.
 */
const MODEL = "onnx-community/whisper-small";

export interface Request {
    seq: number;
    /** Mono, 16 kHz samples. */
    samples: Float32Array;
    language?: string;
}

export type Response = { seq: number; text: string } | { seq: number; error: string };

type Transcriber = ((audio: Float32Array, options?: object) => Promise<{ text: string } | Array<{ text: string }>>) &
    Pick<LanguageDetector, "processor" | "model">;

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
        // The library's own types are far wider (and null where ours are not): this is the part used here.
        return (await pipeline("automatic-speech-recognition", MODEL, {
            // Quantised: a quarter of the size, and no worse at speech at this size.
            dtype: device === "webgpu" ? "fp16" : "q8",
            device,
        })) as unknown as Transcriber;
    })());
    // A model that could not be fetched (offline, the first time) is not the model: without this the
    // failure is what every later request is handed until the worker is replaced.
    loading.catch(() => {
        if (transcriber === loading) transcriber = undefined;
    });
    return loading;
}

/**
 * The language to ask for when nobody said: transformers.js would otherwise force English, which turns
 * Polish or German speech into English-sounding nonsense. A failed guess is left to that default.
 */
async function detect(engine: Transcriber, samples: Float32Array): Promise<string | undefined> {
    try {
        return await detectLanguage(
            {
                processor: engine.processor,
                model: engine.model,
                makePrompt: (token) => new Tensor("int64", BigInt64Array.from([BigInt(token)]), [1, 1]),
            },
            samples,
        );
    } catch {
        return undefined;
    }
}

ctx.addEventListener("message", async (event: MessageEvent<Request>): Promise<void> => {
    const { seq, samples, language } = event.data;
    try {
        const engine = await getTranscriber();
        const spoken = language ?? (await detect(engine, samples));
        const result = await engine(samples, {
            // Long audio in half-minute pieces with a little overlap, which is how whisper is meant to
            // be given anything longer than it can hold at once.
            chunk_length_s: 30,
            stride_length_s: 5,
            ...(spoken ? { language: spoken } : {}),
        });
        const text = (Array.isArray(result) ? result.map((part) => part.text).join(" ") : result.text).trim();
        ctx.postMessage({ seq, text } satisfies Response);
    } catch (error) {
        ctx.postMessage({ seq, error: String((error as Error)?.message ?? error) } satisfies Response);
    }
});
