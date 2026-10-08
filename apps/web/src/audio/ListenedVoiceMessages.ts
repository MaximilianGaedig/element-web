/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// oxlint-disable-next-line no-restricted-imports
import EventEmitter from "events";
import { type MatrixEvent } from "matrix-js-sdk/src/matrix";

const LISTENED_KEY = "mx_voice_message_listened";
const SINCE_KEY = "mx_voice_message_listened_since";
const CHANGED = "changed";

/** How many played messages are remembered: the most recent ones, which are the ones that can still be unplayed. */
const REMEMBERED = 2000;

const emitter = new EventEmitter();
let cache: Set<string> | undefined;

function listened(): Set<string> {
    if (!cache) {
        try {
            cache = new Set(JSON.parse(localStorage.getItem(LISTENED_KEY) ?? "[]"));
        } catch {
            cache = new Set();
        }
    }
    return cache;
}

/** When messages started counting: the first time this was asked. */
function since(): number {
    const stored = Number(localStorage.getItem(SINCE_KEY));
    if (stored) return stored;
    const now = Date.now();
    localStorage.setItem(SINCE_KEY, String(now));
    return now;
}

/**
 * Which voice messages have been played, for the dot the other messengers show beside a voice message
 * nobody has listened to yet. Kept on this device.
 *
 * Nothing sent before this was first used counts as unplayed: there is no telling which of a history's
 * messages were listened to somewhere else, and a dot on every old one says nothing.
 */
export const ListenedVoiceMessages = {
    /** Whether somebody else's voice message arrived since this was first used and has not been played. */
    isUnplayed(event: MatrixEvent, ownUserId: string | null): boolean {
        const id = event.getId();
        if (!id || event.getSender() === ownUserId || event.isSending()) return false;
        return event.getTs() > since() && !listened().has(id);
    },

    mark(eventId: string): void {
        const known = listened();
        if (known.has(eventId)) return;
        known.add(eventId);
        // A set iterates in the order it was added to, so the oldest are the first.
        for (const old of known) {
            if (known.size <= REMEMBERED) break;
            known.delete(old);
        }
        localStorage.setItem(LISTENED_KEY, JSON.stringify([...known]));
        emitter.emit(CHANGED, eventId);
    },

    /** For `useSyncExternalStore`: calls `onChange` when a message is marked, and returns how to stop. */
    // An arrow function, so it can be handed over as it is.
    subscribe: (onChange: () => void): (() => void) => {
        emitter.on(CHANGED, onChange);
        return () => void emitter.off(CHANGED, onChange);
    },

    /** Forgets what was read from storage, as a fresh page would: for tests. */
    reset(): void {
        cache = undefined;
    },
};
