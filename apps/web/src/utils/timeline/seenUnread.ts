/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * The mentions and reactions the reader has seen in a room, kept across sessions. What the timeline offers
 * to jump to is worked out from the read receipt, and seeing a mention or a reaction above the end of the
 * room does not move the receipt past it, so after a reload the @ and heart buttons offered them again.
 * Event IDs: of the mentioning message, and of each reaction.
 */
const MAX_PER_ROOM = 300;

function key(roomId: string): string {
    return `mx_seen_unread:${roomId}`;
}

export function readSeenUnread(roomId: string): Set<string> {
    try {
        const ids = JSON.parse(localStorage.getItem(key(roomId)) ?? "[]");
        return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
    } catch {
        return new Set();
    }
}

/** Adds to what is kept for the room, dropping the oldest beyond {@link MAX_PER_ROOM}. */
export function rememberSeenUnread(roomId: string, seen: Set<string>, ids: Iterable<string>): void {
    for (const id of ids) {
        seen.delete(id); // re-added at the end, as the newest
        seen.add(id);
    }
    const kept = [...seen].slice(-MAX_PER_ROOM);
    try {
        localStorage.setItem(key(roomId), JSON.stringify(kept));
    } catch {
        // Storage full or unavailable: seen for this session only.
    }
}
