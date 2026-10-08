/*
Copyright 2024 New Vector Ltd.
Copyright 2021 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { SimpleObservable } from "matrix-widget-api";
import { type MatrixEvent } from "matrix-js-sdk/src/matrix";

import { type IDestroyable } from "../utils/IDestroyable";

/**
 * Tracks the position in an audio clip for the Playback that owns it, and tells listeners when it moves.
 *
 * The position is read from the element playing the clip, so it is the position that is actually being
 * heard (including at any playback speed). While nothing is playing the clock is stopped and reads zero;
 * a paused clip keeps the position it was paused at.
 *
 * The clip duration is fed to the clock by the Playback: it may only be known once the clip has been
 * decoded, and the event's own duration stands in until then.
 */
export class PlaybackClock implements IDestroyable {
    private stopped = true;
    private lastCheck = 0;
    private observable = new SimpleObservable<number[]>();
    private timerId?: number;
    private clipDuration = 0;
    private placeholderDuration = 0;

    /** @param position Where the clip is now, in seconds, as the element playing it says. */
    public constructor(private position: () => number) {}

    public get durationSeconds(): number {
        return this.clipDuration || this.placeholderDuration;
    }

    public set durationSeconds(val: number) {
        this.clipDuration = val;
        this.observable.update([this.timeSeconds, this.clipDuration]);
    }

    public get timeSeconds(): number {
        if (this.stopped) return 0;
        const duration = this.durationSeconds;
        const now = this.position() || 0;
        return duration ? Math.min(now, duration) : now;
    }

    public get liveData(): SimpleObservable<number[]> {
        return this.observable;
    }

    private checkTime = (force = false): void => {
        const now = this.timeSeconds; // calculated dynamically
        if (this.lastCheck !== now || force) {
            this.observable.update([now, this.durationSeconds]);
            this.lastCheck = now;
        }
    };

    /**
     * Populates default information about the audio clip from the event body.
     * The placeholders will be overridden once known.
     * @param {MatrixEvent} event The event to use for placeholders.
     */
    public populatePlaceholdersFrom(event: MatrixEvent): void {
        const durationMs = Number(event.getContent()["info"]?.["duration"]);
        if (Number.isFinite(durationMs)) this.placeholderDuration = durationMs / 1000;
    }

    /** The clip is loaded and ready: tells listeners the duration without moving the position. */
    public flagLoadTime(): void {
        this.checkTime(true);
    }

    public flagStart(): void {
        this.stopped = false;
        // 50ms keeps the waveform and the seek bar moving smoothly without a frame loop.
        this.timerId ??= window.setInterval(this.checkTime, 50);
        this.checkTime(true);
    }

    /** Paused: the position is kept, nothing needs polling until it plays again. */
    public flagPause(): void {
        this.checkTime(true);
        this.stopTimer();
    }

    /** Finished or stopped: back to the start. */
    public flagStop(): void {
        this.stopped = true;
        this.stopTimer();
        // Update now so that components check their seek/position information (alongside the clock).
        this.checkTime(true);
    }

    /** The clip was moved: count as a pause at the new position, if it was stopped. */
    public syncTo(): void {
        this.stopped = false;
        this.checkTime(true);
    }

    private stopTimer(): void {
        if (this.timerId) clearInterval(this.timerId);
        this.timerId = undefined;
    }

    public destroy(): void {
        this.observable.close();
        this.stopTimer();
    }
}
