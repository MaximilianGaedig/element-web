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
import { logger } from "matrix-js-sdk/src/logger";

import { detectLanguage, type LanguageDetector } from "../utils/detect/whisperLanguage";

/**
 * Which model, by what runs it. On a GPU, large-v3-turbo: it reads a short Polish voice message
 * correctly where small gets half of it wrong, and in 4-bit weights it is about 560 MB to fetch once
 * (the browser keeps it). On the CPU that model takes ten seconds for six, so it gets small, which is
 * about a quarter of a gigabyte. Base turned the same message into nonsense. The model is let go again
 * when idle.
 */
const MODELS = {
    webgpu: {
        name: "onnx-community/whisper-large-v3-turbo",
        dtype: { encoder_model: "q4f16", decoder_model_merged: "q4f16" },
    },
    wasm: { name: "onnx-community/whisper-small", dtype: "q8" },
} as const;

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

/** Loads the model that suits a device. */
async function load(device: "webgpu" | "wasm"): Promise<Transcriber> {
    const { name, dtype } = MODELS[device];
    // The library's own types are far wider (and null where ours are not): this is the part used here.
    return (await pipeline("automatic-speech-recognition", name, { dtype, device })) as unknown as Transcriber;
}

/** The one engine of this worker: loading it is most of the cost of a short transcript. */
function getTranscriber(): Promise<Transcriber> {
    const loading = (transcriber ??= (async () => {
        const device = await bestDevice();
        if (device === "wasm") return load("wasm");
        // A GPU the browser lists but cannot run the model on (a driver without fp16, too little memory)
        // is no reason to give up: the CPU does it, slower.
        return load("webgpu").catch((error) => {
            logger.warn("Could not load the transcriber on the GPU, using the CPU", error);
            return load("wasm");
        });
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
