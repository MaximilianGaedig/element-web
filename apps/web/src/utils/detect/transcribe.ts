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
 * than none, and these are messages people are going to trust. It is asked for a language rather than
 * being told one - these chats are in Polish, German and English by turns.
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

type Transcriber = (audio: Float32Array, options?: object) => Promise<{ text: string } | Array<{ text: string }>>;

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

/** The one engine for this session: loading it is most of the cost of a short transcript. */
async function getTranscriber(): Promise<Transcriber> {
    transcriber ??= (async () => {
        const { pipeline } = await import("@huggingface/transformers");
        const device = await bestDevice();
        return (await pipeline("automatic-speech-recognition", MODEL, {
            // Quantised: a quarter of the size, and no worse at speech at this size.
            dtype: device === "webgpu" ? "fp16" : "q8",
            device,
        })) as unknown as Transcriber;
    })();
    return transcriber;
}

/** Lets the model's memory go once a session is done asking for transcripts. */
export function forgetTranscriber(): void {
    transcriber = undefined;
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
 * What was said in a piece of audio, or nothing where it could not be worked out.
 *
 * `language` is a hint, not an instruction: left out, whisper decides, which is what a chat that
 * switches language between messages needs.
 */
export async function transcribe(audio: ArrayBuffer, language?: string): Promise<string | undefined> {
    try {
        const [engine, samples] = await Promise.all([getTranscriber(), samplesOf(audio)]);
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
    }
}
