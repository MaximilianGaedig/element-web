/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// oxlint-disable-next-line no-restricted-imports
import EventEmitter from "events";

/** The speeds voice messages cycle through, as Telegram, WhatsApp and Signal offer them. */
export const PLAYBACK_SPEEDS = [1, 1.5, 2] as const;

const KEY = "mx_voice_message_speed";
const CHANGED = "changed";

const emitter = new EventEmitter();

/**
 * How fast voice messages play, for all of them: the speed chosen on one carries on to the next one that
 * plays by itself, and to the next chat, as in the other messengers. Kept on this device.
 */
export const PlaybackSpeed = {
    /** The speed in use. Anything stored that is not one of the offered speeds is ignored. */
    get current(): number {
        const stored = Number(localStorage.getItem(KEY));
        return PLAYBACK_SPEEDS.find((speed) => speed === stored) ?? 1;
    },

    set(speed: number): void {
        if (speed === PlaybackSpeed.current) return;
        localStorage.setItem(KEY, String(speed));
        emitter.emit(CHANGED, speed);
    },

    /** Moves on to the next speed, from the last one back to normal. */
    cycle(): number {
        const index = PLAYBACK_SPEEDS.findIndex((speed) => speed === PlaybackSpeed.current);
        const next = PLAYBACK_SPEEDS[(index + 1) % PLAYBACK_SPEEDS.length];
        PlaybackSpeed.set(next);
        return next;
    },

    /** For `useSyncExternalStore`: calls `onChange` when the speed changes, and returns how to stop. */
    // An arrow function, so it can be handed over as it is.
    subscribe: (onChange: () => void): (() => void) => {
        emitter.on(CHANGED, onChange);
        return () => void emitter.off(CHANGED, onChange);
    },
};
