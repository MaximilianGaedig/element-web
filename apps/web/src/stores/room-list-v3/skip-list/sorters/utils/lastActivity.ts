/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The last real activity seen in each room, kept across reloads.
 *
 * A room's place in the list comes from the last event in it that counts (a message, not a rename). The
 * client only ever holds a window of a room's timeline, and that window can hold nothing that counts: a
 * bridge renaming thirty ghosts in a group sends thirty member events, a sync that was limited keeps only
 * those, and the replay at startup keeps only the latest few. The message the room was sorted by is still
 * the right answer, it is just no longer in memory - so it is remembered here when it is seen.
 */

const STORAGE_KEY = "mx_room_last_activity";
/** Writes are batched: a sync touches many rooms at once, and each one should not rewrite the lot. */
const SAVE_DELAY_MS = 2000;

let known: Map<string, number> | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function load(): Map<string, number> {
    if (known) return known;
    try {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
        known = new Map(
            Object.entries(stored).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
        );
    } catch {
        known = new Map();
    }
    return known;
}

function save(): void {
    if (saveTimer !== undefined) return;
    saveTimer = setTimeout(() => {
        saveTimer = undefined;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(load())));
        } catch {
            // Storage full or unavailable: the list still sorts, it only forgets across reloads.
        }
    }, SAVE_DELAY_MS);
}

/** The last activity remembered for a room, if any was ever seen. */
export function rememberedActivity(roomId: string): number | undefined {
    return load().get(roomId);
}

/** Records activity seen in a room. Only ever moves forward: an older event seen later changes nothing. */
export function rememberActivity(roomId: string, ts: number): void {
    const map = load();
    if ((map.get(roomId) ?? 0) >= ts) return;
    map.set(roomId, ts);
    save();
}

/** For tests: forget everything, in memory and in storage. */
export function forgetActivity(): void {
    known = new Map();
    clearTimeout(saveTimer);
    saveTimer = undefined;
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        // nothing to forget
    }
}
