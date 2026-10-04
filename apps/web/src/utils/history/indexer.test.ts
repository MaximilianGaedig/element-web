/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
    createClient,
    Direction,
    type IRoomEvent,
    LOCAL_PAGINATION_PREFIX,
    type MatrixClient,
    MatrixEvent,
    MemoryStore,
    Room,
    RoomEvent,
} from "matrix-js-sdk/src/matrix";

import { historyIndexer } from "./indexer";
import { cachedTimelineBefore } from "./localHistory";
import { clearHistoryDb } from "./db";

const roomId = "!room:example.org";
const userId = "@me:example.org";
const raw = (id: string): IRoomEvent => ({
    event_id: id,
    room_id: roomId,
    type: "m.room.message",
    sender: userId,
    origin_server_ts: 0,
    content: { msgtype: "m.text", body: id },
});

describe("historyIndexer", () => {
    let client: MatrixClient;

    beforeEach(async () => {
        (globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory();
        await clearHistoryDb();
        const store = Object.assign(new MemoryStore(), { getCachedTimelineBefore: cachedTimelineBefore });
        client = createClient({ baseUrl: "https://example.org", userId, store });
        historyIndexer.start(client);
    });

    afterEach(() => historyIndexer.stop());

    /** Adds events to a room's live timeline as a sync would, and waits for the indexer to write them. */
    const sync = async (ids: IRoomEvent[], prevBatch: string): Promise<Room> => {
        const room = new Room(roomId, client, userId, { timelineSupport: true });
        // The client re-emits a room's timeline events once it knows the room, as it does for synced rooms.
        client.store.storeRoom(room);
        client.reEmitter.reEmit(room, [RoomEvent.Timeline]);
        room.getLiveTimeline().setPaginationToken(prevBatch, Direction.Backward);
        await room.addLiveEvents(
            ids.map((e) => new MatrixEvent(e)),
            { addToState: false },
        );
        await vi.waitFor(() => expect(historyIndexer["pending"].size).toBe(0), { timeout: 3000 });
        // the write runs after the pending set is taken
        await vi.waitFor(async () =>
            expect(await cachedTimelineBefore(roomId, ids[ids.length - 1].event_id)).toBeTruthy(),
        );
        return room;
    };

    it("records what it sees so that a later session pages back through it from disk", async () => {
        await sync([raw("$a"), raw("$b"), raw("$c")], "t_before_a");

        // A later session starts from the cache with only $c.
        const later = await sync([raw("$c"), raw("$d")], "t_before_c");

        await vi.waitFor(
            () =>
                expect(later.getLiveTimeline().getPaginationToken(Direction.Backward)).toBe(
                    `${LOCAL_PAGINATION_PREFIX}$c`,
                ),
            { timeout: 3000 },
        );
        expect(await cachedTimelineBefore(roomId, "$c")).toEqual({
            events: [raw("$a"), raw("$b")],
            prevBatch: "t_before_a",
        });
    });
});
