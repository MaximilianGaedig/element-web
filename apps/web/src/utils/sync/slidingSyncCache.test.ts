/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { IRoomEvent, IStateEvent, MatrixClient } from "matrix-js-sdk/src/matrix";
import { type MSC3575RoomData, type SlidingSync, SlidingSyncEvent } from "matrix-js-sdk/src/sliding-sync";
import { IDBFactory } from "fake-indexeddb";

import {
    CACHED_TIMELINE,
    clearSlidingSyncCache,
    FIRST_ROOMS,
    mergeRoomData,
    SlidingSyncCacheStore,
} from "./slidingSyncCache";
import { ROOM_LIST_STATE_TYPES } from "./roomListState";

const ME = "@me:example.org";
const message = (id: string, sender = "@bob:example.org"): IRoomEvent => ({
    type: "m.room.message",
    event_id: id,
    sender,
    origin_server_ts: 1,
    content: { body: id, msgtype: "m.text" },
});
const state = (type: string, stateKey = "", content: object = {}): IStateEvent => ({
    type,
    state_key: stateKey,
    event_id: `$${type}${stateKey}${JSON.stringify(content)}`,
    sender: ME,
    origin_server_ts: 1,
    content,
});
const keepListState = (event: IStateEvent): boolean => ROOM_LIST_STATE_TYPES.includes(event.type);

describe("mergeRoomData", () => {
    it("keeps the state the chat list reads, replaced by type and key, and nothing else", () => {
        let room = mergeRoomData(
            undefined,
            {
                initial: true,
                required_state: [state("m.room.name", "", { name: "Old" }), state("m.room.topic", "", { topic: "t" })],
                timeline: [],
            },
            keepListState,
        );
        room = mergeRoomData(
            room,
            { required_state: [state("m.room.name", "", { name: "New" })], timeline: [] },
            keepListState,
        );

        expect(room.required_state.map((event) => [event.type, event.content])).toEqual([
            ["m.room.name", { name: "New" }],
        ]);
    });

    it("keeps the latest few events, without repeats", () => {
        let room = mergeRoomData(
            undefined,
            { initial: true, required_state: [], timeline: [message("$1"), message("$2")] },
            keepListState,
        );
        room = mergeRoomData(
            room,
            { required_state: [], timeline: ["$2", "$3", "$4", "$5", "$6", "$7"].map((id) => message(id)) },
            keepListState,
        );

        expect(room.timeline.map((event) => event.event_id)).toEqual(["$3", "$4", "$5", "$6", "$7"]);
        expect(room.timeline).toHaveLength(CACHED_TIMELINE);
    });

    // Kept side by side, the two would hide whatever was said in between.
    it("lets the kept events go when a limited timeline does not carry on from them", () => {
        let room = mergeRoomData(
            undefined,
            { initial: true, required_state: [], timeline: [message("$1"), message("$2")] },
            keepListState,
        );
        room = mergeRoomData(room, { limited: true, required_state: [], timeline: [message("$9")] }, keepListState);

        expect(room.timeline.map((event) => event.event_id)).toEqual(["$9"]);
    });

    it("takes the names and counts as the server last gave them", () => {
        let room = mergeRoomData(
            undefined,
            { initial: true, required_state: [], timeline: [], name: "A", notification_count: 3, bump_stamp: 5 },
            keepListState,
        );
        room = mergeRoomData(room, { required_state: [], timeline: [], notification_count: 0 }, keepListState);

        expect([room.name, room.notification_count, room.bump_stamp]).toEqual(["A", 0, 5]);
    });
});

describe("SlidingSyncCacheStore", () => {
    class FakeSlidingSync extends EventEmitter {}
    let client: MatrixClient;
    const rooms = new Map<
        string,
        {
            roomId: string;
            accountData: Map<string, { getType(): string; getContent(): object }>;
            tags: Record<string, object>;
        }
    >();

    beforeEach(async () => {
        // A database of its own for each test; node has none of its own.
        (globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory();
        await clearSlidingSyncCache();
        rooms.clear();
        client = Object.assign(new EventEmitter(), {
            getRoom: (roomId: string) => rooms.get(roomId) ?? null,
        }) as unknown as MatrixClient;
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    const describeRoom = (sync: FakeSlidingSync, roomId: string, data: Partial<MSC3575RoomData>): void => {
        sync.emit(SlidingSyncEvent.RoomData, roomId, { required_state: [], timeline: [], initial: true, ...data });
    };

    it("hands the next session the most recent rooms first, the favourites with them, and the rest after", async () => {
        const store = new SlidingSyncCacheStore(ME, ROOM_LIST_STATE_TYPES);
        const sync = new FakeSlidingSync();
        store.record(sync as unknown as SlidingSync, client);
        const count = FIRST_ROOMS + 10;
        for (let i = 0; i < count; i++) {
            const roomId = `!r${i}:example.org`;
            rooms.set(roomId, { roomId, accountData: new Map(), tags: i === 0 ? { "m.favourite": {} } : {} });
            describeRoom(sync, roomId, { bump_stamp: i, timeline: [message(`$${i}`)] });
        }
        client.emit("accountData" as any, { getType: () => "m.direct", getContent: () => ({ [ME]: [] }) });
        await store.save(client);

        const next = new SlidingSyncCacheStore(ME, ROOM_LIST_STATE_TYPES);
        const first = await next.loadFirst();
        const rest = await next.loadRest();

        const firstIds = Object.keys(first!.rooms);
        expect(firstIds).toContain("!r0:example.org"); // the favourite, though the least recent
        expect(firstIds).toContain(`!r${count - 1}:example.org`); // the most recent
        expect(firstIds).toHaveLength(FIRST_ROOMS + 1);
        expect(Object.keys(rest!)).toHaveLength(count - FIRST_ROOMS - 1);
        expect(first!.accountData.global).toEqual([{ type: "m.direct", content: { [ME]: [] } }]);
        // replayed as complete descriptions, with the history before them to be asked for
        expect(first!.rooms["!r0:example.org"]).toMatchObject({ initial: true, limited: true, prev_batch: undefined });
    });

    it("forgets a room that has been left", async () => {
        const store = new SlidingSyncCacheStore(ME, ROOM_LIST_STATE_TYPES);
        const sync = new FakeSlidingSync();
        store.record(sync as unknown as SlidingSync, client);
        rooms.set("!gone:example.org", { roomId: "!gone:example.org", accountData: new Map(), tags: {} });
        describeRoom(sync, "!gone:example.org", {});
        client.emit("Room.myMembership" as any, { roomId: "!gone:example.org" }, "leave");
        await store.save(client);

        const next = new SlidingSyncCacheStore(ME, ROOM_LIST_STATE_TYPES);
        expect(Object.keys((await next.loadFirst())?.rooms ?? {})).toEqual([]);
    });

    it("keeps the cached account data when the session never reaches the server", async () => {
        const store = new SlidingSyncCacheStore(ME, ROOM_LIST_STATE_TYPES);
        const sync = new FakeSlidingSync();
        store.record(sync as unknown as SlidingSync, client);
        client.emit("accountData" as any, { getType: () => "m.push_rules", getContent: () => ({ global: {} }) });
        await store.save(client);

        const offline = new SlidingSyncCacheStore(ME, ROOM_LIST_STATE_TYPES);
        await offline.loadFirst();
        await offline.save(client);

        const next = new SlidingSyncCacheStore(ME, ROOM_LIST_STATE_TYPES);
        expect((await next.loadFirst())?.accountData.global).toEqual([
            { type: "m.push_rules", content: { global: {} } },
        ]);
    });
});
