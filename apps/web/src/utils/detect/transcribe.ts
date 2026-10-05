/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * What a voice message said, in words, worked out on the device.
 *
 * Whisper, through transformers.js, in whatever the browser offers: WebGPU where there is one, and the
 * CPU where there is not. The audio never leaves the device - only the model comes down, once, the first
 * time somebody asks for a transcript, and the browser keeps it cached afterwards. That is the one thing
 * here that needs the network, and it needs it once.
 *
 * "base" rather than "tiny": tiny mishears names and numbers badly enough that a transcript is worse
 * than none, and these are messages people are going to trust. The language is worked out from each
 * message rather than set - these chats are in Polish, German and English by turns.
 *
 * Asked for, never automatic: a minute of audio is a few seconds of work and a warm phone, and most
 * voice messages get listened to instead. What is worked out once is sent to the server (mediaText.ts),
 * so nobody's device ever does it twice.
 */

import { logger } from "matrix-js-sdk/src/logger";

/** What whisper wants: mono, 16 kHz, as plain samples. */
const SAMPLE_RATE = 16_000;

/** Small enough to fetch on a phone, good enough to trust with a name or a number. */
const MODEL = "onnx-community/whisper-base";

/**
 * The runtime that runs the model, served by us.
 *
 * Left to itself transformers.js fetches it from a CDN and imports it from a `blob:` URL, and the app's
 * content policy allows scripts from neither: every transcript failed with "no available backend found".
 * Webpack emits both files with the build (the factory under a `.js` name, see webpack.config.ts) and
 * these are their URLs. The `.asyncify` build is the one transformers.js picks, and the one that also
 * runs on the GPU.
 */
export const RUNTIME_FILES = {
    mjs: new URL("onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs", import.meta.url).href,
    wasm: new URL("onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm", import.meta.url).href,
};

/** The model's one step from the start of a transcript: a score for every token that could come next. */
interface LanguageScores {
    logits: { dims: number[]; data: ArrayLike<number> };
}

type Transcriber = ((audio: Float32Array, options?: object) => Promise<{ text: string } | Array<{ text: string }>>) & {
    /** Gives back the model's sessions and their memory. */
    dispose?: () => Promise<unknown>;
    /** Turns audio into what the model reads. */
    processor: (audio: Float32Array) => Promise<{ input_features: unknown }>;
    /** The model itself, run one step at a time. */
    model: ((inputs: { input_features: unknown; decoder_input_ids: unknown }) => Promise<LanguageScores>) & {
        generation_config: {
            decoder_start_token_id: number;
            is_multilingual?: boolean;
            /** `<|pl|>` and the like, to their tokens. */
            lang_to_id?: Record<string, number>;
        };
    };
};

/** Builds the model's input tensors; from the library, which is loaded with the model. */
let makeTokens: ((ids: number[]) => unknown) | undefined;

/**
 * How long the model is kept after the last transcript.
 *
 * It is tens of megabytes of weights and the runtime that runs them (or the same on the GPU), and it
 * was kept from the first transcript until the tab was closed - for a feature that is asked for by
 * hand, a message at a time. Two minutes covers working through several voice messages in a row
 * without loading it for each; after that the browser's cache has the files and loading it again is
 * a few seconds in front of a transcript that takes about as long.
 */
export const MODEL_IDLE_MS = 2 * 60_000;

let transcriber: Promise<Transcriber> | undefined;
/** Transcripts being worked out: the model is not let go under any of them. */
let working = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

/** Lets the model go. The next transcript loads it again. */
function releaseTranscriber(): void {
    idleTimer = undefined;
    const releasing = transcriber;
    transcriber = undefined;
    void releasing?.then((engine) => engine.dispose?.()).catch(() => {});
}

/** Whether the model is loaded, for the memory report. */
export function transcriberLoaded(): boolean {
    return transcriber !== undefined;
}

/** Holds the model for one transcript; the returned function lets go and starts the idle clock. */
function holdTranscriber(): () => void {
    working++;
    clearTimeout(idleTimer);
    idleTimer = undefined;
    return () => {
        if (--working > 0) return;
        clearTimeout(idleTimer);
        idleTimer = setTimeout(releaseTranscriber, MODEL_IDLE_MS);
    };
}

/**
 * Whether the device has a GPU to do this on, which decides how long it takes rather than whether.
 *
 * The GPU runs the half-precision model, which needs its `shader-f16` feature: without it the model
 * failed to load ("does not support fp16") instead of running on the CPU.
 */
async function bestDevice(): Promise<"webgpu" | "wasm"> {
    const gpu = (navigator as { gpu?: { requestAdapter(): Promise<{ features?: ReadonlySet<string> } | null> } }).gpu;
    if (!gpu) return "wasm";
    try {
        const adapter = await gpu.requestAdapter();
        return adapter?.features?.has("shader-f16") ? "webgpu" : "wasm";
    } catch {
        return "wasm";
    }
}

/** The one engine while transcripts are being asked for: loading it is most of the cost of a short one. */
async function getTranscriber(): Promise<Transcriber> {
    const loading = (transcriber ??= (async () => {
        const { env, pipeline, Tensor } = await import("@huggingface/transformers");
        makeTokens = (ids) => new Tensor("int64", BigInt64Array.from(ids, BigInt), [1, ids.length]);
        // Our own copy of the runtime, imported from its URL: its cache would hand it over as a `blob:`
        // URL, which the content policy refuses to run.
        env.useWasmCache = false;
        // Set up by transformers.js itself whenever it runs in a browser.
        const wasm = env.backends.onnx.wasm;
        if (wasm) wasm.wasmPaths = { ...RUNTIME_FILES };
        const device = await bestDevice();
        const engine = await pipeline("automatic-speech-recognition", MODEL, {
            // Quantised: a quarter of the size, and no worse at speech at this size.
            dtype: device === "webgpu" ? "fp16" : "q8",
            device,
        });
        // The library types its model only as a generic one; the parts of whisper read here are described
        // by Transcriber.
        return engine as unknown as Transcriber;
    })());
    // A model that could not be fetched (offline, the first time) is not the model: without this the
    // failure is what every later request is handed until the page is reloaded.
    loading.catch(() => {
        if (transcriber === loading) transcriber = undefined;
    });
    return loading;
}

/**
 * The audio as whisper wants it: one channel at 16 kHz.
 *
 * Decoded and resampled by the browser, which does both in one pass and in C++.
 */
async function samplesOf(audio: ArrayBuffer): Promise<Float32Array> {
    const context = new AudioContext({ sampleRate: SAMPLE_RATE });
    try {
        const decoded = await context.decodeAudioData(audio);
        const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * SAMPLE_RATE), SAMPLE_RATE);
        const source = offline.createBufferSource();
        source.buffer = decoded;
        source.connect(offline.destination);
        source.start();
        const mono = await offline.startRendering();
        return mono.getChannelData(0);
    } finally {
        void context.close();
    }
}

/**
 * The language a piece of audio is spoken in, as whisper hears its first half minute.
 *
 * Without one, transformers.js transcribes as English: a Polish message came out as "The", and a German
 * one as English words that went round in a loop. Whisper decides the language with the first step of a
 * transcript, the token after its start, which is one of its languages: the likeliest of those is it.
 */
async function spokenLanguage(engine: Transcriber, samples: Float32Array): Promise<string | undefined> {
    const config = engine.model.generation_config;
    if (!config.is_multilingual || !config.lang_to_id || !makeTokens) return undefined;
    const { input_features } = await engine.processor(samples.subarray(0, 30 * SAMPLE_RATE));
    const { logits } = await engine.model({
        input_features,
        decoder_input_ids: makeTokens([config.decoder_start_token_id]),
    });
    // The scores for the token after the last one given.
    const vocabulary = logits.dims[logits.dims.length - 1];
    const offset = logits.data.length - vocabulary;
    let best: string | undefined;
    let bestScore = -Infinity;
    for (const [token, id] of Object.entries(config.lang_to_id)) {
        const score = logits.data[offset + id];
        if (score > bestScore) {
            bestScore = score;
            best = token.slice(2, -2);
        }
    }
    return best;
}

/**
 * What was said in a piece of audio, or nothing where it could not be worked out.
 *
 * `language` is the language it is spoken in, where that is known: left out, it is worked out from the
 * audio (spokenLanguage), which is what a chat that switches language between messages needs.
 */
export async function transcribe(audio: ArrayBuffer, language?: string): Promise<string | undefined> {
    const letGo = holdTranscriber();
    try {
        const [engine, samples] = await Promise.all([getTranscriber(), samplesOf(audio)]);
        language ??= await spokenLanguage(engine, samples);
        const result = await engine(samples, {
            // Long audio in half-minute pieces with a little overlap, which is how whisper is meant to
            // be given anything longer than it can hold at once.
            chunk_length_s: 30,
            stride_length_s: 5,
            ...(language ? { language } : {}),
        });
        const text = (Array.isArray(result) ? result.map((part) => part.text).join(" ") : result.text).trim();
        return text || undefined;
    } catch (error) {
        logger.warn("Could not transcribe a voice message", error);
        return undefined;
    } finally {
        letGo();
    }
}
