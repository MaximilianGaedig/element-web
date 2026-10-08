/*
Copyright 2024 New Vector Ltd.
Copyright 2021 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// oxlint-disable-next-line no-restricted-imports
import EventEmitter from "events";
import { SimpleObservable } from "matrix-widget-api";
import { logger } from "matrix-js-sdk/src/logger";
import { clamp } from "@element-hq/web-shared-components";

import { UPDATE_EVENT } from "../stores/AsyncStore";
import { arrayFastResample } from "../utils/arrays";
import { type IDestroyable } from "../utils/IDestroyable";
import { PlaybackClock } from "./PlaybackClock";
import { createAudioContext, decodeOgg } from "./compat";
import { DEFAULT_WAVEFORM, PLAYBACK_WAVEFORM_SAMPLES } from "./consts";
import { PlaybackEncoder } from "../PlaybackEncoder";

export enum PlaybackState {
    Preparing = "preparing", // preparing to decode
    Decoding = "decoding",
    Stopped = "stopped", // no progress on timeline
    Paused = "paused", // some progress on timeline
    Playing = "playing", // active progress through timeline
}

const THUMBNAIL_WAVEFORM_SAMPLES = 100; // arbitrary: [30,120]

export interface PlaybackInterface {
    readonly currentState: PlaybackState;
    readonly liveData: SimpleObservable<number[]>;
    readonly timeSeconds: number;
    readonly durationSeconds: number;
    skipTo(timeSeconds: number): Promise<void>;
}

export class Playback extends EventEmitter implements IDestroyable, PlaybackInterface {
    /**
     * Stable waveform for representing a thumbnail of the media. Values are
     * guaranteed to be between zero and one, inclusive.
     */
    public readonly thumbnailWaveform: number[];

    /**
     * Only alive while the clip is being decoded for its waveform: the clip is played by an <audio />
     * element, which unlike a decoded buffer keeps the pitch when the speed changes and holds the clip
     * compressed rather than as 48,000 floats for every second of it.
     */
    private context?: AudioContext;
    private state = PlaybackState.Decoding;
    private audioBuf?: AudioBuffer;
    private element?: HTMLAudioElement;
    private resampledWaveform: number[];
    private waveformObservable = new SimpleObservable<number[]>();
    private readonly clock: PlaybackClock;
    private readonly fileSize: number;
    private destroyed = false;
    private rate = 1;

    /**
     * Creates a new playback instance from a buffer.
     * @param {ArrayBuffer} buf The buffer containing the sound sample.
     * @param {number[]} seedWaveform Optional seed waveform to present until the proper waveform
     * can be calculated. Contains values between zero and one, inclusive.
     */
    public constructor(
        private buf: ArrayBuffer,
        seedWaveform = DEFAULT_WAVEFORM,
    ) {
        super();
        // Capture the file size early as reading the buffer will result in a 0-length buffer left behind
        this.fileSize = this.buf.byteLength;
        this.resampledWaveform = arrayFastResample(seedWaveform ?? DEFAULT_WAVEFORM, PLAYBACK_WAVEFORM_SAMPLES);
        this.thumbnailWaveform = arrayFastResample(seedWaveform ?? DEFAULT_WAVEFORM, THUMBNAIL_WAVEFORM_SAMPLES);
        this.waveformObservable.update(this.resampledWaveform);
        this.clock = new PlaybackClock(() => this.element?.currentTime ?? 0);
    }

    /**
     * Size of the audio clip in bytes. May be zero if unknown. This is updated
     * when the playback goes through phase changes.
     */
    public get sizeBytes(): number {
        return this.fileSize;
    }

    /**
     * Stable waveform for the playback. Values are guaranteed to be between
     * zero and one, inclusive.
     */
    public get waveform(): number[] {
        return this.resampledWaveform;
    }

    public get waveformData(): SimpleObservable<number[]> {
        return this.waveformObservable;
    }

    public get clockInfo(): PlaybackClock {
        return this.clock;
    }

    public get liveData(): SimpleObservable<number[]> {
        return this.clock.liveData;
    }

    public get timeSeconds(): number {
        return this.clock.timeSeconds;
    }

    public get durationSeconds(): number {
        return this.clock.durationSeconds;
    }

    public get currentState(): PlaybackState {
        return this.state;
    }

    public get isPlaying(): boolean {
        return this.currentState === PlaybackState.Playing;
    }

    /** How fast the clip plays, 1 being as recorded. The pitch stays where it was recorded. */
    public get playbackRate(): number {
        return this.rate;
    }

    public setPlaybackRate(rate: number): void {
        this.rate = rate;
        if (this.element) this.element.playbackRate = rate;
    }

    public emit(event: PlaybackState, ...args: any[]): boolean {
        this.state = event;
        super.emit(event, ...args);
        super.emit(UPDATE_EVENT, event, ...args);
        return true; // we don't ever care if the event had listeners, so just return "yes"
    }

    public destroy(): void {
        this.destroyed = true;
        // Dev note: It's critical that we call stop() during cleanup to ensure that downstream callers
        // are aware of the final clock position before the user triggered an unload.
        void this.stop().catch(() => {});
        this.closeContext();
        this.removeAllListeners();
        this.clock.destroy();
        this.waveformObservable.close();
        if (this.element) {
            this.element.removeEventListener("ended", this.onPlaybackEnd);
            URL.revokeObjectURL(this.element.src);
            // So the browser lets go of the clip rather than waiting for the element to be collected.
            this.element.removeAttribute("src");
            this.element.load();
            this.element.remove();
        }
        // The decoded samples are by far the largest thing here (48,000 floats per second of audio, per
        // channel) and live outside the JS heap. Anything still holding this playback - a closure, a
        // queue - must not be holding them too.
        this.audioBuf = undefined;
        this.buf = new ArrayBuffer(0);
    }

    /**
     * Closes the decoding context: a context holds an audio device and a rendering graph until it is
     * closed or collected, and a chat's worth of voice messages is a chat's worth of contexts.
     */
    private closeContext(): void {
        const context = this.context;
        this.context = undefined;
        context?.close().catch((e) => logger.warn("Could not close a playback's audio context", e));
    }

    /** An <audio /> element holding `bytes`, ready to play. */
    private async loadElement(bytes: ArrayBuffer): Promise<HTMLAudioElement | undefined> {
        const element = document.createElement("AUDIO") as HTMLAudioElement;
        const deferred = Promise.withResolvers<unknown>();
        element.onloadeddata = deferred.resolve;
        element.onerror = deferred.reject;
        element.src = URL.createObjectURL(new Blob([bytes]));
        element.playbackRate = this.rate;
        element.preservesPitch = true;
        await deferred.promise; // make sure the audio element is ready for us
        element.onloadeddata = null;
        element.onerror = null;
        if (this.destroyed) {
            // destroy() ran before there was an element for it to clean up.
            URL.revokeObjectURL(element.src);
            element.remove();
            return undefined;
        }
        element.addEventListener("ended", this.onPlaybackEnd);
        return element;
    }

    public async prepare(): Promise<void> {
        // don't attempt to decode the media again
        // AudioContext.decodeAudioData detaches the array buffer `this.buf`
        // meaning it cannot be re-read
        if (this.state !== PlaybackState.Decoding) {
            return;
        }

        this.state = PlaybackState.Preparing;

        // The bytes the element plays. Whatever is decoded for the waveform is a copy: decodeAudioData
        // detaches the buffer it is given, so a copy has to be taken before it is called.
        let playable = this.buf;

        // Voice messages want a waveform, which needs the clip decoded; a big file is more likely music
        // or a recording than a message, and decoding it balloons to far greater than its byte length, so
        // those are only played.
        if (this.buf.byteLength <= 5 * 1024 * 1024) {
            // 5mb
            playable = this.buf.slice(0);
            this.context = createAudioContext();
            const context = this.context;
            try {
                this.audioBuf = await context.decodeAudioData(this.buf);
            } catch (e) {
                // Nothing to fall back for: the context was closed under the decode.
                if (this.destroyed) return;
                logger.error("Error decoding recording:", e);
                logger.warn("Trying to re-encode to WAV instead...");

                try {
                    // This error handler is largely for Safari, which doesn't support Opus/Ogg very well,
                    // and there the element needs the re-encoded clip too.
                    const wav = await decodeOgg(playable);
                    playable = wav.slice(0);
                    this.audioBuf = await context.decodeAudioData(wav);
                } catch (e) {
                    logger.error("Error decoding recording:", e);
                    throw e;
                }
            }

            if (this.destroyed) {
                // Destroyed while it was decoding: what was just decoded is nobody's to play.
                this.audioBuf = undefined;
                return;
            }

            // Update the waveform to the real waveform once we have channel data to use. We don't
            // exactly trust the user-provided waveform to be accurate...
            this.resampledWaveform = await PlaybackEncoder.instance.getPlaybackWaveform(
                this.audioBuf.getChannelData(0),
            );
        }

        // Destroyed while the waveform was being worked out.
        if (this.destroyed) return;

        const element = await this.loadElement(playable);
        if (!element) return;
        this.element = element;

        this.waveformObservable.update(this.resampledWaveform);

        // The decoded length is the reliable one: an element reports Infinity for some recordings.
        const duration = this.audioBuf?.duration ?? element.duration;
        this.audioBuf = undefined;
        this.closeContext();

        this.clock.durationSeconds = duration;

        // Signal that we're not decoding anymore. This is done last to ensure the clock is updated for
        // when the downstream callers try to use it.
        this.emit(PlaybackState.Stopped); // signal that we're not decoding anymore
    }

    private onPlaybackEnd = async (): Promise<void> => {
        this.element?.pause();
        if (this.element) this.element.currentTime = 0;
        this.emit(PlaybackState.Stopped);
        this.clock.flagStop();
    };

    public async play(): Promise<void> {
        const element = this.element;
        if (!element) return;
        element.playbackRate = this.rate;
        try {
            await element.play();
        } catch (e) {
            // Pausing straight after pressing play interrupts the start, which is no failure.
            if ((e as Error).name !== "AbortError") logger.warn("Could not play a recording", e);
            return;
        }
        this.clock.flagStart();
        this.emit(PlaybackState.Playing);
    }

    public async pause(): Promise<void> {
        this.element?.pause();
        this.clock.flagPause();
        this.emit(PlaybackState.Paused);
    }

    public stop(): Promise<void> {
        return this.onPlaybackEnd();
    }

    public async toggle(): Promise<void> {
        if (this.isPlaying) await this.pause();
        else await this.play();
    }

    public async skipTo(timeSeconds: number): Promise<void> {
        const element = this.element;
        if (!element) return;

        timeSeconds = clamp(timeSeconds, 0, this.clock.durationSeconds);
        element.currentTime = timeSeconds;
        this.clock.syncTo();

        // Seeking a clip that is not playing must not start it, and counts as being paused at the new
        // spot (a stopped clip has no position to show).
        if (!this.isPlaying) await this.pause();
    }
}
