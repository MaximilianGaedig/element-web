/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The Stream's ordering: messages from many rooms in one list, by time.
 *
 * Each room holds only part of its history in memory (the chat list's sync brings the last few
 * messages of every room, opening or paging a room brings more). Merging whatever happens to be loaded
 * would be wrong: a room whose older messages are not loaded yet would look silent over a time it was
 * not. So the list only reaches back as far as every room is known: the newest of the rooms' oldest
 * loaded messages (the "bound"). Above it the merge is complete; to go further back, the rooms holding
 * the bound up are paged, and only those.
 *
 * Kept free of Matrix objects so the rules can be tested on their own.
 */

/** One message a room would show in the Stream. */
export interface StreamSourceEvent {
    eventId: string;
    ts: number;
    sender: string;
}

/** What one room has loaded. */
export interface StreamSource {
    roomId: string;
    /** The messages to show, in the room's own order (oldest first). */
    events: StreamSourceEvent[];
    /**
     * The timestamp of the first loaded event in the room's order, shown or not; undefined when nothing
     * is loaded. The room's own order is used rather than the smallest timestamp: it is where paging
     * back continues from.
     */
    oldestLoadedTs?: number;
    /** Whether the room has older history that is not loaded. */
    canPaginateBack: boolean;
}

/** One row of the Stream. */
export interface StreamEntry extends StreamSourceEvent {
    roomId: string;
}

/**
 * How far back the merge is complete: the newest of the oldest loaded timestamps among the rooms that
 * have more to load. `-Infinity` once every room is loaded to its start.
 *
 * A room with nothing loaded and more to load is left out: it has no position to hold the list at,
 * and counting it as "now" would empty the Stream until it was paged.
 */
export function streamBound(sources: Iterable<StreamSource>): number {
    let bound = -Infinity;
    for (const source of sources) {
        if (!source.canPaginateBack || source.oldestLoadedTs === undefined) continue;
        if (source.oldestLoadedTs > bound) bound = source.oldestLoadedTs;
    }
    return bound;
}

/**
 * The messages at or after `bound`, merged by time across rooms.
 *
 * A room's own messages keep the room's order even where their timestamps disagree with it (bridged
 * history can carry the original send times out of order), so the merge takes the earliest of the
 * rooms' next messages rather than sorting everything by timestamp. Equal times go to the room listed
 * first, so the order is stable from one build to the next.
 */
export function mergeStream(sources: readonly StreamSource[], bound: number): StreamEntry[] {
    // Per room, where its messages at or after the bound begin. Only these rooms take part.
    const lanes: Array<{ roomId: string; events: StreamSourceEvent[]; next: number }> = [];
    for (const source of sources) {
        const { events } = source;
        let start = events.length;
        while (start > 0 && events[start - 1].ts >= bound) start--;
        if (start < events.length) lanes.push({ roomId: source.roomId, events, next: start });
    }

    // Few rooms are active over the span the bound leaves, so a scan of their heads is cheaper than a heap.
    const merged: StreamEntry[] = [];
    for (;;) {
        let pick = -1;
        let pickTs = Infinity;
        for (let i = 0; i < lanes.length; i++) {
            const lane = lanes[i];
            if (lane.next >= lane.events.length) continue;
            const ts = lane.events[lane.next].ts;
            if (ts < pickTs) {
                pick = i;
                pickTs = ts;
            }
        }
        if (pick < 0) return merged;
        const lane = lanes[pick];
        merged.push({ ...lane.events[lane.next], roomId: lane.roomId });
        lane.next++;
    }
}

/**
 * The rooms to page back next to move the bound: those with more to load, newest first, at most `max`.
 * The first is the one holding the bound; the next ones are where the bound goes after it.
 */
export function roomsToPaginate(sources: Iterable<StreamSource>, max: number): string[] {
    const candidates: Array<{ roomId: string; ts: number }> = [];
    for (const source of sources) {
        if (!source.canPaginateBack || source.oldestLoadedTs === undefined) continue;
        candidates.push({ roomId: source.roomId, ts: source.oldestLoadedTs });
    }
    candidates.sort((a, b) => b.ts - a.ts);
    return candidates.slice(0, max).map((c) => c.roomId);
}
