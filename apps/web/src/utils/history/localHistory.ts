/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * A room's history from the local message database, so that scrolling back through what Element has
 * already seen needs no server, offline too.
 *
 * Sliding sync keeps only the last few events of each room between sessions; everything older came from
 * the server every time. The message database (db.ts) already holds every message Element has seen. What it
 * did not know is the order they came in, or where they stop. So for each event it records the event just
 * before it, as the timeline showed them, and for the earliest event of a timeline the server's token for
 * what comes before that.
 *
 * The SDK pages back from a token of the form `mx_stored_before:<event ID>` by asking the store for the
 * events before that event (MatrixClient.storedMessagesBefore). Under sliding sync the store has nothing of
 * its own, so it asks here. A timeline whose earliest event has stored events before it is given such a
 * token in place of the server's, which is kept to carry on from where the stored events run out. Every
 * answer ends with a way to carry on: another stored event, a server token, or the room's creation. A
 * missing one would make the SDK take the room for complete (the history pitfall of MEO-89).
 */

import {
    type CachedTimelineChunk,
    Direction,
    type EventTimeline,
    EventType,
    FROM_LATEST_PAGINATION_TOKEN,
    type IRoomEvent,
    LOCAL_PAGINATION_PREFIX,
    type Room,
} from "matrix-js-sdk/src/matrix";

import { type EventLink, getLinks, storedChainBefore, storeLinks } from "./db";

/** How many stored events one page back gives: what the timeline asks the server for in one go. */
export const STORED_PAGE = 100;

/** Whether a pagination token is the server's, rather than one of ours or "from the latest". */
function isServerToken(token: string | null): token is string {
    return !!token && !token.startsWith(LOCAL_PAGINATION_PREFIX) && token !== FROM_LATEST_PAGINATION_TOKEN;
}

/** Whether a timeline is a room's own history (not a thread's, nor the notifications'). */
export function isRoomHistory(room: Room | undefined, timeline: EventTimeline | undefined): timeline is EventTimeline {
    return !!room && !!timeline && timeline.getTimelineSet() === room.getUnfilteredTimelineSet();
}

/** Where each of a timeline's events sits, as the timeline shows them. */
export function linksOf(timeline: EventTimeline): EventLink[] {
    const roomId = timeline.getRoomId();
    if (!roomId) return [];
    // Local echoes are not in the database and have no place in the room's history yet.
    const events = timeline.getEvents().filter((event) => !!event.getId() && !event.getId()!.startsWith("~"));
    if (!events.length) return [];

    const links: EventLink[] = events
        .slice(1)
        .map((event, i) => ({ eventId: event.getId()!, roomId, prevId: events[i].getId()! }));
    const first = events[0];
    const token = timeline.getPaginationToken(Direction.Backward);
    if (isServerToken(token)) {
        links.push({ eventId: first.getId()!, roomId, backToken: token });
    } else if (token === null && first.getType() === EventType.RoomCreate) {
        links.push({ eventId: first.getId()!, roomId, atStart: true });
    }
    return links;
}

/** How many timelines are recorded at a time: a start replays every room's, and the page stays responsive. */
const RECORD_BATCH = 100;

/**
 * Records where the events of these timelines sit. With `readBack` (the store answers from here), a timeline
 * whose earliest event has stored events before it then pages back from them first.
 */
export async function recordTimelines(timelines: Iterable<EventTimeline>, readBack: boolean): Promise<void> {
    const all = [...timelines];
    for (let i = 0; i < all.length; i += RECORD_BATCH) {
        if (i) await new Promise((resolve) => setTimeout(resolve, 0));
        await recordBatch(all.slice(i, i + RECORD_BATCH), readBack);
    }
}

async function recordBatch(all: EventTimeline[], readBack: boolean): Promise<void> {
    await storeLinks(all.flatMap(linksOf));
    if (!readBack) return;

    const candidates = all.flatMap((timeline) => {
        const roomId = timeline.getRoomId();
        const firstId = timeline.getEvents()[0]?.getId();
        const token = timeline.getPaginationToken(Direction.Backward);
        if (!roomId || !firstId || firstId.startsWith("~")) return [];
        if (!isServerToken(token) && token !== FROM_LATEST_PAGINATION_TOKEN) return [];
        return [{ timeline, roomId, firstId, token }];
    });
    if (!candidates.length) return;
    const known = await getLinks(candidates.map((c) => c.firstId));
    const switching = candidates.filter((c) => known.get(c.firstId)?.prevId);
    // The token in use is kept with the event first: it is where the server carries on once the stored
    // events run out.
    await storeLinks(switching.map(({ roomId, firstId, token }) => ({ eventId: firstId, roomId, backToken: token })));
    for (const { timeline, firstId, token } of switching) {
        // Only if nothing moved meanwhile (a page came in, or the timeline was replaced).
        if (timeline.getEvents()[0]?.getId() !== firstId) continue;
        if (timeline.getPaginationToken(Direction.Backward) !== token) continue;
        timeline.setPaginationToken(LOCAL_PAGINATION_PREFIX + firstId, Direction.Backward);
    }
}

/**
 * The stored events before `eventId`, oldest first, and where to carry on before them: the store method
 * the SDK pages back with (IStore.getCachedTimelineBefore).
 */
export async function cachedTimelineBefore(roomId: string, eventId: string): Promise<CachedTimelineChunk | null> {
    // One more than a page: if it is there, the page can say "carry on from what is stored" with certainty.
    const { start, chain } = await storedChainBefore(roomId, eventId, STORED_PAGE + 1);
    if (chain.length > STORED_PAGE) {
        const page = chain.slice(0, STORED_PAGE);
        return chunk(page, LOCAL_PAGINATION_PREFIX + page[page.length - 1].event.eventId);
    }

    // The stored events run out here. Carry on from the oldest one that knows where the server does.
    const oldest = chain[chain.length - 1];
    if (oldest?.link?.atStart) return chunk(chain, null);
    for (let i = chain.length - 1; i >= 0; i--) {
        const backToken = chain[i].link?.backToken;
        if (backToken) return chunk(chain.slice(0, i + 1), backToken);
    }
    // None of them does: give none of them, and carry on where the event asked about does. That was kept
    // before its timeline was sent here; failing that, from the latest, as a room with no token does.
    return chunk([], start?.backToken ?? FROM_LATEST_PAGINATION_TOKEN);
}

function chunk(newestFirst: Array<{ event: { raw: IRoomEvent } }>, prevBatch: string | null): CachedTimelineChunk {
    return { events: newestFirst.map(({ event }) => event.raw).reverse(), prevBatch };
}
