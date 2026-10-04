/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
    createClient,
    Direction,
    type EventTimeline,
    EventType,
    FROM_LATEST_PAGINATION_TOKEN,
    type IRoomEvent,
    LOCAL_PAGINATION_PREFIX,
    type MatrixClient,
    MatrixEvent,
    MemoryStore,
    Room,
} from "matrix-js-sdk/src/matrix";

import { cachedTimelineBefore, linksOf, recordTimelines, STORED_PAGE } from "./localHistory";
import { clearHistoryDb, storeEvents } from "./db";

const roomId = "!room:example.org";
const userId = "@me:example.org";

const raw = (id: string, type: string = EventType.RoomMessage, ts = 0): IRoomEvent => ({
    event_id: id,
    room_id: roomId,
    type,
    sender: userId,
    origin_server_ts: ts,
    content: type === EventType.RoomMessage ? { msgtype: "m.text", body: id } : {},
});

describe("local history", () => {
    let client: MatrixClient;
    let room: Room;

    beforeEach(async () => {
        (globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory();
        await clearHistoryDb();
        const store = Object.assign(new MemoryStore(), { getCachedTimelineBefore: cachedTimelineBefore });
        client = createClient({ baseUrl: "https://example.org", userId, store });
        room = new Room(roomId, client, userId, { timelineSupport: true });
    });

    /**
     * A timeline holding these events (oldest first), with this token before them. Each is the room as one
     * session saw it: a fresh Room, so the SDK does not join timelines that share an event.
     */
    const timelineOf = (ids: IRoomEvent[], backToken: string | null): EventTimeline => {
        room = new Room(roomId, client, userId, { timelineSupport: true });
        const set = room.getUnfilteredTimelineSet();
        const timeline = set.addTimeline();
        set.addEventsToTimeline(
            ids.map((e) => new MatrixEvent(e)),
            false,
            false,
            timeline,
        );
        timeline.setPaginationToken(backToken, Direction.Backward);
        return timeline;
    };

    /** As the message indexer does: the events first, then where they sit. */
    const see = async (timeline: EventTimeline, readBack = true): Promise<void> => {
        await storeEvents(
            timeline
                .getEvents()
                .map((e) => ({ eventId: e.getId()!, roomId, ts: e.getTs(), raw: e.event as IRoomEvent })),
        );
        await recordTimelines([timeline], readBack);
    };

    it("links each event to the one before it, and the earliest to the server's token", () => {
        const timeline = timelineOf([raw("$a"), raw("$b"), raw("$c")], "t_before_a");
        expect(linksOf(timeline)).toEqual([
            { eventId: "$b", roomId, prevId: "$a" },
            { eventId: "$c", roomId, prevId: "$b" },
            { eventId: "$a", roomId, backToken: "t_before_a" },
        ]);
    });

    it("knows the room's creation as its start, and no token as nothing", () => {
        expect(linksOf(timelineOf([raw("$create", EventType.RoomCreate), raw("$m")], null))).toContainEqual({
            eventId: "$create",
            roomId,
            atStart: true,
        });
        expect(linksOf(timelineOf([raw("$x"), raw("$y")], FROM_LATEST_PAGINATION_TOKEN))).toEqual([
            { eventId: "$y", roomId, prevId: "$x" },
        ]);
    });

    // A session that starts from the cache has only the latest events; what was seen before is on disk.
    it("pages back through what was seen before without the server, and carries on where the server does", async () => {
        // An earlier session paged back through $a..$e, and saw $e then $f live.
        await see(timelineOf([raw("$a"), raw("$b"), raw("$c"), raw("$d"), raw("$e"), raw("$f")], "t_before_a"));
        // This session starts from the cache: $f and $g, with the server's token before $f.
        const live = timelineOf([raw("$f"), raw("$g")], "t_before_f");
        await see(live);

        expect(live.getPaginationToken(Direction.Backward)).toBe(`${LOCAL_PAGINATION_PREFIX}$f`);

        const page = await client.createMessagesRequest(roomId, `${LOCAL_PAGINATION_PREFIX}$f`, 30, Direction.Backward);
        expect(page.chunk.map((e) => e.event_id)).toEqual(["$e", "$d", "$c", "$b", "$a"]); // newest first
        expect(page.end).toBe("t_before_a");
    });

    it("never ends a page without a way on, unless it reached the room's creation", async () => {
        // $b..$c were seen together but nothing about what is before $b: the page must not claim the start.
        await see(timelineOf([raw("$b"), raw("$c")], FROM_LATEST_PAGINATION_TOKEN));
        const live = timelineOf([raw("$c"), raw("$d")], "t_before_c");
        await see(live);

        const chunk = await cachedTimelineBefore(roomId, "$c");
        // Nothing before $b is known, so $b is not given; the server carries on from before $c.
        expect(chunk).toEqual({ events: [], prevBatch: "t_before_c" });

        await see(timelineOf([raw("$create", EventType.RoomCreate), raw("$1"), raw("$2")], null));
        await see(timelineOf([raw("$2"), raw("$3")], "t_before_2"));
        expect(await cachedTimelineBefore(roomId, "$2")).toEqual({
            events: [raw("$create", EventType.RoomCreate), raw("$1")],
            prevBatch: null,
        });
    });

    it("gives a page at a time, and the next page from where the last one stopped", async () => {
        const ids = Array.from({ length: STORED_PAGE + 20 }, (_, i) => raw(`$e${i}`, EventType.RoomMessage, i));
        await see(timelineOf(ids, "t_before_e0"));
        const newest = ids[ids.length - 1].event_id;

        const first = await cachedTimelineBefore(roomId, newest);
        expect(first?.events).toHaveLength(STORED_PAGE);
        expect(first?.prevBatch).toBe(`${LOCAL_PAGINATION_PREFIX}${first?.events[0].event_id}`);

        const second = await cachedTimelineBefore(roomId, first!.events[0].event_id!);
        expect(second?.events.map((e) => e.event_id)).toEqual(ids.slice(0, 19).map((e) => e.event_id));
        expect(second?.prevBatch).toBe("t_before_e0");
    });

    it("leaves the server's token alone when nothing is stored before the earliest event, or the store cannot answer", async () => {
        const fresh = timelineOf([raw("$p"), raw("$q")], "t_before_p");
        await see(fresh);
        expect(fresh.getPaginationToken(Direction.Backward)).toBe("t_before_p");

        await see(timelineOf([raw("$o"), raw("$p")], "t_before_o"));
        const notReadBack = timelineOf([raw("$p"), raw("$r")], "t_before_p2");
        await see(notReadBack, false);
        expect(notReadBack.getPaginationToken(Direction.Backward)).toBe("t_before_p2");
    });
});
