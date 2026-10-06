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

import transcribeWorkerFactory from "../../workers/transcribeWorkerFactory";
import { type Request, type Response } from "../../workers/transcribe.worker";

/** What whisper wants: mono, 16 kHz, as plain samples. */
const SAMPLE_RATE = 16_000;

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

/** The worker the model runs in, so a transcript never holds the page's own thread. */
let worker: Worker | undefined;
const pending = new Map<number, PromiseWithResolvers<string>>();
let seq = 0;
/** Transcripts being worked out: the model is not let go under any of them. */
let working = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

/** Lets the model go, by ending the worker it lives in. The next transcript starts a new one. */
function releaseTranscriber(): void {
    idleTimer = undefined;
    worker?.terminate();
    worker = undefined;
}

/** Whether the model is loaded, for the memory report. */
export function transcriberLoaded(): boolean {
    return worker !== undefined;
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

function getWorker(): Worker {
    if (worker) return worker;
    const created = transcribeWorkerFactory();
    created.onmessage = (event: MessageEvent<Response>): void => {
        const reply = event.data;
        const waiting = pending.get(reply.seq);
        pending.delete(reply.seq);
        if ("error" in reply) waiting?.reject(new Error(reply.error));
        else waiting?.resolve(reply.text);
    };
    // A worker that died (out of memory, a script that would not load) takes its waiting transcripts with
    // it and is not the worker for the next one.
    created.onerror = (event: ErrorEvent): void => {
        if (worker === created) releaseTranscriber();
        for (const waiting of pending.values()) waiting.reject(new Error(event.message || "transcriber failed"));
        pending.clear();
    };
    worker = created;
    return created;
}

/** Runs the model over the samples, in the worker. */
function recognise(samples: Float32Array, language?: string): Promise<string> {
    const deferred = Promise.withResolvers<string>();
    const id = seq++;
    pending.set(id, deferred);
    // Handed over rather than copied: nothing here wants the samples again.
    getWorker().postMessage({ seq: id, samples, language } satisfies Request, [samples.buffer]);
    return deferred.promise;
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
    const letGo = holdTranscriber();
    try {
        const text = await recognise(await samplesOf(audio), language);
        return text || undefined;
    } catch (error) {
        logger.warn("Could not transcribe a voice message", error);
        return undefined;
    } finally {
        letGo();
    }
}
