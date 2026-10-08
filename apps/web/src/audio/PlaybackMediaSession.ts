/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type Playback, PlaybackState } from "./Playback";
import { UPDATE_EVENT } from "../stores/AsyncStore";

/** How far the lock screen's skip buttons go, as the other messengers' do. */
const SKIP_SECONDS = 10;

/** The playback whose controls are on the lock screen, headphones and media keys right now. */
let owner: Playback | undefined;

const ACTIONS: MediaSessionAction[] = ["play", "pause", "stop", "seekbackward", "seekforward", "seekto"];

function setHandlers(playback: Playback | undefined): void {
    const handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = playback
        ? {
              play: () => void playback.play(),
              pause: () => void playback.pause(),
              stop: () => void playback.stop(),
              seekbackward: ({ seekOffset }) =>
                  void playback.skipTo(playback.timeSeconds - (seekOffset ?? SKIP_SECONDS)),
              seekforward: ({ seekOffset }) =>
                  void playback.skipTo(playback.timeSeconds + (seekOffset ?? SKIP_SECONDS)),
              seekto: ({ seekTime }) => void playback.skipTo(seekTime ?? 0),
          }
        : {};
    for (const action of ACTIONS) {
        try {
            navigator.mediaSession.setActionHandler(action, handlers[action] ?? null);
        } catch {
            // An action this browser does not know: the others still work.
        }
    }
}

function publishPosition(playback: Playback): void {
    const duration = playback.durationSeconds;
    if (!duration || !Number.isFinite(duration)) return;
    try {
        navigator.mediaSession.setPositionState({
            duration,
            playbackRate: playback.playbackRate,
            position: Math.min(playback.timeSeconds, duration),
        });
    } catch {
        // Positions the browser refuses are not worth a broken player.
    }
}

/**
 * Puts a voice message on the system's media controls while it plays: the lock screen, headphone
 * buttons, media keys and a phone's notification shade show what it is and let it be paused, skipped
 * ten seconds either way and scrubbed, as they do for the other messengers' voice messages.
 *
 * Whichever message plays last owns the controls, and they go when it stops.
 *
 * @param title What the controls call the message, e.g. who sent it.
 * @param artist What they put under it, e.g. the chat.
 * @returns How to let go, for when the message goes away.
 */
export function attachMediaSession(playback: Playback, title: string, artist: string): () => void {
    if (typeof navigator === "undefined" || !navigator.mediaSession) return () => {};
    const session = navigator.mediaSession;

    const onUpdate = (state: PlaybackState): void => {
        if (state === PlaybackState.Playing) {
            owner = playback;
            session.metadata = new MediaMetadata({ title, artist });
            setHandlers(playback);
            session.playbackState = "playing";
            publishPosition(playback);
        } else if (owner === playback) {
            if (state === PlaybackState.Paused) {
                session.playbackState = "paused";
                publishPosition(playback);
            } else if (state === PlaybackState.Stopped) {
                release();
            }
        }
    };

    const release = (): void => {
        if (owner !== playback) return;
        owner = undefined;
        session.metadata = null;
        session.playbackState = "none";
        setHandlers(undefined);
    };

    playback.on(UPDATE_EVENT, onUpdate);
    return () => {
        playback.off(UPDATE_EVENT, onUpdate);
        release();
    };
}
