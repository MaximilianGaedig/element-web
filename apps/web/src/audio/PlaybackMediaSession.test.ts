/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach } from "vitest";

import { type Playback, PlaybackState } from "./Playback";
import { attachMediaSession } from "./PlaybackMediaSession";
import { UPDATE_EVENT } from "../stores/AsyncStore";
// oxlint-disable-next-line no-restricted-imports
import EventEmitter from "events";

class FakePlayback extends EventEmitter {
    public timeSeconds = 5;
    public durationSeconds = 30;
    public playbackRate = 1.5;
    public play = vi.fn();
    public pause = vi.fn();
    public stop = vi.fn();
    public skipTo = vi.fn();

    public state(state: PlaybackState): void {
        this.emit(UPDATE_EVENT, state);
    }
}

describe("attachMediaSession", () => {
    const handlers = new Map<string, ((details: any) => void) | null>();
    const session = {
        metadata: null as unknown,
        playbackState: "none",
        setActionHandler: vi.fn((action: string, handler: ((details: any) => void) | null) => {
            handlers.set(action, handler);
        }),
        setPositionState: vi.fn(),
    };

    beforeEach(() => {
        handlers.clear();
        session.metadata = null;
        session.playbackState = "none";
        session.setPositionState.mockClear();
        vi.stubGlobal(
            "MediaMetadata",
            class {
                constructor(public init: object) {}
            },
        );
        Object.defineProperty(navigator, "mediaSession", { value: session, configurable: true });
    });

    const attach = (playback: FakePlayback) =>
        attachMediaSession(playback as unknown as Playback, "Voice message from Alice", "Family");

    it("shows what is playing, and its place in it, while it plays", () => {
        const playback = new FakePlayback();
        attach(playback);

        playback.state(PlaybackState.Playing);

        expect(session.metadata).toMatchObject({ init: { title: "Voice message from Alice", artist: "Family" } });
        expect(session.playbackState).toBe("playing");
        expect(session.setPositionState).toHaveBeenCalledWith({ duration: 30, playbackRate: 1.5, position: 5 });
    });

    it("pauses, skips ten seconds either way and scrubs from the system's controls", () => {
        const playback = new FakePlayback();
        attach(playback);
        playback.state(PlaybackState.Playing);

        handlers.get("pause")!({});
        handlers.get("seekbackward")!({});
        handlers.get("seekforward")!({ seekOffset: 15 });
        handlers.get("seekto")!({ seekTime: 12 });

        expect(playback.pause).toHaveBeenCalled();
        expect(playback.skipTo).toHaveBeenNthCalledWith(1, -5);
        expect(playback.skipTo).toHaveBeenNthCalledWith(2, 20);
        expect(playback.skipTo).toHaveBeenNthCalledWith(3, 12);
    });

    it("says it is paused, and lets go when it stops", () => {
        const playback = new FakePlayback();
        attach(playback);
        playback.state(PlaybackState.Playing);

        playback.state(PlaybackState.Paused);
        expect(session.playbackState).toBe("paused");

        playback.state(PlaybackState.Stopped);
        expect(session.metadata).toBeNull();
        expect(session.playbackState).toBe("none");
        expect(handlers.get("pause")).toBeNull();
    });

    it("gives the controls to whichever message plays last", () => {
        const first = new FakePlayback();
        const second = new FakePlayback();
        attach(first);
        attach(second);
        first.state(PlaybackState.Playing);

        second.state(PlaybackState.Playing);
        // The first one stopping must not take the second one's controls with it.
        first.state(PlaybackState.Stopped);

        expect(session.playbackState).toBe("playing");
        handlers.get("pause")!({});
        expect(second.pause).toHaveBeenCalled();
        expect(first.pause).not.toHaveBeenCalled();
    });

    it("lets go when the message goes away", () => {
        const playback = new FakePlayback();
        const detach = attach(playback);
        playback.state(PlaybackState.Playing);

        detach();

        expect(session.playbackState).toBe("none");
        expect(playback.listenerCount(UPDATE_EVENT)).toBe(0);
    });

    it("does nothing where there are no media controls", () => {
        Object.defineProperty(navigator, "mediaSession", { value: undefined, configurable: true });
        const playback = new FakePlayback();

        expect(() => attach(playback)()).not.toThrow();
        expect(playback.listenerCount(UPDATE_EVENT)).toBe(0);
    });
});
