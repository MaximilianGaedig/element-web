/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The answer being written right now, so the timeline can show it arriving in place.
 *
 * It is one small thing that two distant parts of the app need: the bar that asks, and the timeline that
 * shows. Threading it through the rooms, the panels and the tiles between them would mean a prop in five
 * files for a string that lives for four seconds, so it is kept here and listened to.
 */

/** What is being written, and where it belongs. */
export interface Streaming {
    /** The message the answer sits under. */
    anchor: string;
    /** The room it is being written in, so another room's timeline ignores it. */
    roomId: string;
    text: string;
    /** What the model is doing, while it is doing it rather than after. */
    looking?: string;
}

let current: Streaming | undefined;
const listeners = new Set<() => void>();

export function streaming(): Streaming | undefined {
    return current;
}

export function setStreaming(next: Streaming | undefined): void {
    current = next;
    for (const listener of listeners) listener();
}

/** Listens until the returned function is called. */
export function onStreaming(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
