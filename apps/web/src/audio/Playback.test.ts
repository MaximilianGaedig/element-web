/*
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logger } from "matrix-js-sdk/src/logger";

import { createAudioContext, decodeOgg } from "./compat";
import { Playback, PlaybackState } from "./Playback";

vi.mock("../WorkerManager", () => ({
    WorkerManager: vi.fn(function () {
        return {
            call: vi.fn().mockResolvedValue({ waveform: [0, 0, 1, 1] }),
        };
    }),
}));

vi.mock("./compat", () => ({
    createAudioContext: vi.fn(),
    decodeOgg: vi.fn(),
}));

describe("Playback", () => {
    const mockAudioContext = {
        decodeAudioData: vi.fn(),
        close: vi.fn(),
    };

    const mockAudioBuffer = {
        duration: 99,
        getChannelData: vi.fn(),
    };

    const mockChannelData = new Float32Array();

    let element: ReturnType<typeof mockAudioElement>;

    /**
     * A stand-in for the <audio /> element Playback plays through. Assigning `src` resolves the load
     * the same way the browser does, and listeners registered on it can be fired by hand.
     */
    const mockAudioElement = () => {
        const listeners = new Map<string, Set<() => void | Promise<void>>>();
        const el = {
            duration: 42,
            currentTime: 0,
            playbackRate: 1,
            preservesPitch: false,
            onloadeddata: undefined as undefined | null | (() => void),
            onerror: undefined as undefined | null | (() => void),
            play: vi.fn().mockResolvedValue(undefined),
            pause: vi.fn(),
            load: vi.fn(),
            remove: vi.fn(),
            removeAttribute: vi.fn(),
            addEventListener: vi.fn((type: string, cb: () => void) => {
                if (!listeners.has(type)) listeners.set(type, new Set());
                listeners.get(type)!.add(cb);
            }),
            removeEventListener: vi.fn((type: string, cb: () => void) => {
                listeners.get(type)?.delete(cb);
            }),
            listenerCount: (type: string): number => listeners.get(type)?.size ?? 0,
            fire: async (type: string): Promise<void> => {
                for (const cb of listeners.get(type) ?? []) await cb();
            },
        };
        Object.defineProperty(el, "src", {
            set() {
                el.onloadeddata?.();
            },
            get: () => "blob:audio",
        });
        return el;
    };

    beforeEach(() => {
        vi.spyOn(logger, "error").mockRestore();
        mockAudioBuffer.getChannelData.mockClear().mockReturnValue(mockChannelData);
        mockAudioContext.decodeAudioData.mockReset().mockResolvedValue(mockAudioBuffer);
        mockAudioContext.close.mockClear().mockResolvedValue(undefined);
        vi.mocked(decodeOgg).mockClear().mockResolvedValue(new ArrayBuffer(1));
        vi.mocked(createAudioContext).mockReturnValue(mockAudioContext as unknown as AudioContext);
        element = mockAudioElement();
        vi.spyOn(document, "createElement").mockReturnValue(element as unknown as HTMLElement);
        global.URL.createObjectURL = vi.fn().mockReturnValue("blob:audio");
        global.URL.revokeObjectURL = vi.fn();
    });

    afterEach(() => {
        vi.mocked(document.createElement).mockRestore();
    });

    it("initialises correctly", () => {
        const buffer = new ArrayBuffer(8);

        const playback = new Playback(buffer);
        playback.clockInfo.durationSeconds = mockAudioBuffer.duration;

        expect(playback.sizeBytes).toEqual(8);
        expect(playback.clockInfo).toBeTruthy();
        expect(playback.liveData).toBe(playback.clockInfo.liveData);
        expect(playback.timeSeconds).toBe(0);
        expect(playback.currentState).toEqual(PlaybackState.Decoding);
    });

    it("toggles playback on from stopped state", async () => {
        const playback = new Playback(new ArrayBuffer(8));
        await playback.prepare();
        // state is Stopped
        await playback.toggle();

        expect(element.play).toHaveBeenCalled();
        expect(playback.currentState).toEqual(PlaybackState.Playing);
    });

    it("toggles playback to paused from playing state", async () => {
        const playback = new Playback(new ArrayBuffer(8));
        await playback.prepare();
        await playback.toggle();
        expect(playback.currentState).toEqual(PlaybackState.Playing);

        await playback.toggle();

        expect(element.pause).toHaveBeenCalled();
        expect(playback.currentState).toEqual(PlaybackState.Paused);
    });

    it("keeps its place when paused, and resumes from it", async () => {
        const playback = new Playback(new ArrayBuffer(8));
        await playback.prepare();
        await playback.play();
        element.currentTime = 12;
        await playback.pause();

        expect(playback.timeSeconds).toEqual(12);

        element.play.mockClear();
        await playback.play();
        expect(element.currentTime).toEqual(12);
        expect(element.play).toHaveBeenCalledTimes(1);
    });

    it("reports the position the element is at, not a clock of its own", async () => {
        const playback = new Playback(new ArrayBuffer(8));
        await playback.prepare();
        await playback.play();

        element.currentTime = 7.5;
        expect(playback.timeSeconds).toEqual(7.5);
    });

    it("stop playbacks", async () => {
        const playback = new Playback(new ArrayBuffer(8));
        await playback.prepare();
        await playback.toggle();
        expect(playback.currentState).toEqual(PlaybackState.Playing);

        await playback.stop();

        expect(element.pause).toHaveBeenCalled();
        expect(playback.currentState).toEqual(PlaybackState.Stopped);
    });

    it("stops when the audio ended", async () => {
        const playback = new Playback(new ArrayBuffer(8));
        await playback.prepare();
        await playback.play();
        element.currentTime = 30;

        await element.fire("ended");

        expect(playback.currentState).toEqual(PlaybackState.Stopped);
        // Back at the start, ready to play again
        expect(element.currentTime).toEqual(0);
        expect(playback.timeSeconds).toEqual(0);
    });

    it("does not start playing when seeking a clip that is not playing", async () => {
        const playback = new Playback(new ArrayBuffer(8));
        await playback.prepare();

        await playback.skipTo(20);

        expect(element.currentTime).toEqual(20);
        expect(element.play).not.toHaveBeenCalled();
        expect(playback.currentState).toEqual(PlaybackState.Paused);
        expect(playback.timeSeconds).toEqual(20);
    });

    it("keeps playing when seeking a clip that is playing", async () => {
        const playback = new Playback(new ArrayBuffer(8));
        await playback.prepare();
        await playback.play();

        await playback.skipTo(20);

        expect(element.currentTime).toEqual(20);
        expect(playback.currentState).toEqual(PlaybackState.Playing);
    });

    it("does not seek past the end", async () => {
        const playback = new Playback(new ArrayBuffer(8));
        await playback.prepare();

        await playback.skipTo(1000);

        expect(element.currentTime).toEqual(mockAudioBuffer.duration);
    });

    it("plays after a seek that was made before it ever played", async () => {
        // What the queue does to put a message back where it was left.
        const playback = new Playback(new ArrayBuffer(8));
        await playback.prepare();
        await playback.skipTo(20);

        await playback.play();

        expect(element.play).toHaveBeenCalled();
        expect(playback.currentState).toEqual(PlaybackState.Playing);
        expect(element.currentTime).toEqual(20);
    });

    it("does not report a start that the browser refused", async () => {
        vi.spyOn(logger, "warn").mockReturnValue(undefined);
        element.play.mockRejectedValue(new DOMException("blocked", "NotAllowedError"));
        const playback = new Playback(new ArrayBuffer(8));
        await playback.prepare();

        await playback.play();

        expect(playback.currentState).toEqual(PlaybackState.Stopped);
    });

    describe("speed", () => {
        it("plays at the speed set, keeping the pitch", async () => {
            const playback = new Playback(new ArrayBuffer(8));
            await playback.prepare();

            playback.setPlaybackRate(1.5);
            await playback.play();

            expect(element.playbackRate).toEqual(1.5);
            expect(element.preservesPitch).toEqual(true);
            expect(playback.playbackRate).toEqual(1.5);
        });

        it("changes speed while playing", async () => {
            const playback = new Playback(new ArrayBuffer(8));
            await playback.prepare();
            await playback.play();

            playback.setPlaybackRate(2);

            expect(element.playbackRate).toEqual(2);
        });

        it("keeps a speed chosen before the clip was ready", async () => {
            const playback = new Playback(new ArrayBuffer(8));
            playback.setPlaybackRate(2);

            await playback.prepare();

            expect(element.playbackRate).toEqual(2);
        });
    });

    describe("destroy()", () => {
        // What a playback holds outside the JS heap: an audio context, and the decoded samples, which
        // are far larger than the file (48,000 floats for every second of it).
        it("closes its audio context, once", async () => {
            const playback = new Playback(new ArrayBuffer(8));
            await playback.prepare();

            playback.destroy();
            await vi.waitFor(() => expect(mockAudioContext.close).toHaveBeenCalledTimes(1));
        });

        it("lets go of the decoded audio as soon as the waveform is made", async () => {
            const playback = new Playback(new ArrayBuffer(8));
            await playback.prepare();

            // @ts-ignore
            expect(playback.audioBuf).toBeUndefined();
        });

        it("lets go of the audio element", async () => {
            const playback = new Playback(new ArrayBuffer(8));
            await playback.prepare();

            playback.destroy();

            expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:audio");
            expect(element.remove).toHaveBeenCalled();
            expect(element.listenerCount("ended")).toEqual(0);
        });

        it("does not keep audio that finished decoding after it was destroyed", async () => {
            // A tile scrolled past while its audio was still decoding.
            const decoding = Promise.withResolvers<typeof mockAudioBuffer>();
            mockAudioContext.decodeAudioData.mockReturnValue(decoding.promise);
            const playback = new Playback(new ArrayBuffer(8));
            const prepared = playback.prepare();

            playback.destroy();
            decoding.resolve(mockAudioBuffer);
            await prepared;

            // @ts-ignore
            expect(playback.audioBuf).toBeUndefined();
            expect(document.createElement).not.toHaveBeenCalled();
        });
    });

    describe("prepare()", () => {
        it("decodes audio data when not greater than 5mb", async () => {
            const playback = new Playback(new ArrayBuffer(8));

            await playback.prepare();

            expect(mockAudioContext.decodeAudioData).toHaveBeenCalledTimes(1);
            expect(mockAudioBuffer.getChannelData).toHaveBeenCalledWith(0);

            // clock was updated
            expect(playback.clockInfo.durationSeconds).toEqual(mockAudioBuffer.duration);
            expect(playback.durationSeconds).toEqual(mockAudioBuffer.duration);

            expect(playback.currentState).toEqual(PlaybackState.Stopped);
        });

        it("tries to decode ogg when decodeAudioData fails", async () => {
            // stub logger to keep console clean from expected error
            vi.spyOn(logger, "error").mockReturnValue(undefined);
            vi.spyOn(logger, "warn").mockReturnValue(undefined);

            const decodingError = new Error("test");
            mockAudioContext.decodeAudioData
                .mockRejectedValueOnce(decodingError)
                .mockResolvedValueOnce(mockAudioBuffer);

            const playback = new Playback(new ArrayBuffer(8));

            await playback.prepare();

            expect(mockAudioContext.decodeAudioData).toHaveBeenCalledTimes(2);
            expect(decodeOgg).toHaveBeenCalled();

            // clock was updated
            expect(playback.clockInfo.durationSeconds).toEqual(mockAudioBuffer.duration);
            expect(playback.durationSeconds).toEqual(mockAudioBuffer.duration);

            expect(playback.currentState).toEqual(PlaybackState.Stopped);
        });

        it("plays the re-encoded clip when the browser could not decode the original", async () => {
            vi.spyOn(logger, "error").mockReturnValue(undefined);
            vi.spyOn(logger, "warn").mockReturnValue(undefined);
            mockAudioContext.decodeAudioData
                .mockRejectedValueOnce(new Error("test"))
                .mockResolvedValueOnce(mockAudioBuffer);
            const wav = new ArrayBuffer(3);
            vi.mocked(decodeOgg).mockResolvedValue(wav);
            const blob = vi.spyOn(global, "Blob");

            await new Playback(new ArrayBuffer(8)).prepare();

            // A browser that cannot decode the original cannot play it either.
            expect(blob).toHaveBeenLastCalledWith([expect.objectContaining({ byteLength: 3 })]);
        });

        it("hands the ogg fallback a buffer which decodeAudioData has not detached", async () => {
            // stub logger to keep console clean from expected error
            vi.spyOn(logger, "error").mockReturnValue(undefined);
            vi.spyOn(logger, "warn").mockReturnValue(undefined);

            const buffer = new ArrayBuffer(8);
            mockAudioContext.decodeAudioData
                .mockImplementationOnce((buf: ArrayBuffer) => {
                    // The real decodeAudioData detaches the buffer it is handed, even when it fails.
                    structuredClone(buf, { transfer: [buf] });
                    return Promise.reject(new Error("test"));
                })
                .mockResolvedValueOnce(mockAudioBuffer);
            // Constructing a view over a detached buffer throws, which is what decodeOgg does first.
            vi.mocked(decodeOgg).mockImplementationOnce(async (audioBuffer: ArrayBuffer) => {
                expect(() => new Uint8Array(audioBuffer)).not.toThrow();
                return new ArrayBuffer(1);
            });

            const playback = new Playback(buffer);

            await playback.prepare();

            expect(decodeOgg).toHaveBeenCalled();
            expect(mockAudioContext.decodeAudioData).toHaveBeenCalledTimes(2);
            expect(playback.currentState).toEqual(PlaybackState.Stopped);
        });

        it("does not try to re-decode audio", async () => {
            const playback = new Playback(new ArrayBuffer(8));
            await playback.prepare();
            expect(playback.currentState).toEqual(PlaybackState.Stopped);

            await playback.prepare();

            // only called once in first prepare
            expect(mockAudioContext.decodeAudioData).toHaveBeenCalledTimes(1);
        });
    });

    describe("audio larger than 5mb", () => {
        // Anything over 5mb is only played, not decoded for a waveform
        const largeBuffer = (): ArrayBuffer => new ArrayBuffer(5 * 1024 * 1024 + 1);

        it("is played without being decoded", async () => {
            const playback = new Playback(largeBuffer());
            await playback.prepare();

            expect(mockAudioContext.decodeAudioData).not.toHaveBeenCalled();
            expect(playback.durationSeconds).toEqual(element.duration);
            expect(playback.currentState).toEqual(PlaybackState.Stopped);
        });

        it("stops when the media element ends", async () => {
            const playback = new Playback(largeBuffer());
            await playback.prepare();
            await playback.play();
            expect(playback.currentState).toEqual(PlaybackState.Playing);

            await element.fire("ended");

            expect(playback.currentState).toEqual(PlaybackState.Stopped);
            expect(playback.timeSeconds).toEqual(0);
        });

        it("stops listening to the media element once destroyed", async () => {
            const playback = new Playback(largeBuffer());
            await playback.prepare();
            await playback.play();
            expect(element.listenerCount("ended")).toEqual(1);

            playback.destroy();

            expect(element.listenerCount("ended")).toEqual(0);
        });
    });
});
