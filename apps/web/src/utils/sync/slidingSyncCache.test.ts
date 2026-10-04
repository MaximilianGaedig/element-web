/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { IRoomEvent, IStateEvent, MatrixClient } from "matrix-js-sdk/src/matrix";
import {
    type MSC3575RoomData,
    type SlidingSync,
    SlidingSyncEvent,
    SlidingSyncState,
} from "matrix-js-sdk/src/sliding-sync";
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
/** A room update with only the fields a test is about: as the server sends them, without a name unless it changed. */
const update = (fields: Partial<MSC3575RoomData>): MSC3575RoomData =>
    ({ required_state: [], timeline: [], ...fields }) as MSC3575RoomData;

describe("mergeRoomData", () => {
    it("keeps the state the chat list reads, replaced by type and key, and nothing else", () => {
        let room = mergeRoomData(
            undefined,
            update({
                initial: true,
                required_state: [state("m.room.name", "", { name: "Old" }), state("m.room.topic", "", { topic: "t" })],
                timeline: [],
            }),
            keepListState,
        );
        room = mergeRoomData(
            room,
            update({ required_state: [state("m.room.name", "", { name: "New" })], timeline: [] }),
            keepListState,
        );

        expect(room.required_state.map((event) => [event.type, event.content])).toEqual([
            ["m.room.name", { name: "New" }],
        ]);
    });

    it("keeps the latest few events, without repeats", () => {
        let room = mergeRoomData(
            undefined,
            update({ initial: true, required_state: [], timeline: [message("$1"), message("$2")] }),
            keepListState,
        );
        // $2 again, and then more than are kept.
        const ids = Array.from({ length: CACHED_TIMELINE + 2 }, (_, i) => `$${i + 2}`);
        room = mergeRoomData(
            room,
            update({ required_state: [], timeline: ids.map((id) => message(id)) }),
            keepListState,
        );

        expect(room.timeline.map((event) => event.event_id)).toEqual(ids.slice(-CACHED_TIMELINE));
        expect(new Set(room.timeline.map((event) => event.event_id)).size).toBe(CACHED_TIMELINE);
    });

    // Kept side by side, the two would hide whatever was said in between.
    it("lets the kept events go when a limited timeline does not carry on from them", () => {
        let room = mergeRoomData(
            undefined,
            update({ initial: true, required_state: [], timeline: [message("$1"), message("$2")] }),
            keepListState,
        );
        room = mergeRoomData(
            room,
            update({ limited: true, required_state: [], timeline: [message("$9")] }),
            keepListState,
        );

        expect(room.timeline.map((event) => event.event_id)).toEqual(["$9"]);
    });

    // The next session's timeline goes back into the room's history from the earliest kept event.
    describe("the token for the history before what is kept", () => {
        it("is kept with the earliest event it was given with", () => {
            let room = mergeRoomData(
                undefined,
                update({
                    initial: true,
                    limited: true,
                    required_state: [],
                    timeline: [message("$1")],
                    prev_batch: "t1",
                }),
                keepListState,
            );
            expect(room.prev_batch).toBe("t1");
            room = mergeRoomData(room, update({ required_state: [], timeline: [message("$2")] }), keepListState);
            expect(room.prev_batch).toBe("t1");
        });

        it("is let go with that event, once newer ones push it out", () => {
            let room = mergeRoomData(
                undefined,
                update({
                    initial: true,
                    limited: true,
                    required_state: [],
                    timeline: [message("$0")],
                    prev_batch: "t0",
                }),
                keepListState,
            );
            const ids = Array.from({ length: CACHED_TIMELINE }, (_, i) => `$${i + 1}`);
            room = mergeRoomData(
                room,
                update({ required_state: [], timeline: ids.map((id) => message(id)) }),
                keepListState,
            );
            expect(room.timeline[0].event_id).toBe("$1");
            expect(room.prev_batch).toBeUndefined();
        });

        // Kept above it, the earlier events would sit over a gap no token leads into.
        it("is the new one when a limited timeline does not reach back to the earliest kept event", () => {
            let room = mergeRoomData(
                undefined,
                update({
                    initial: true,
                    limited: true,
                    required_state: [],
                    timeline: [message("$1"), message("$2")],
                    prev_batch: "t1",
                }),
                keepListState,
            );
            room = mergeRoomData(
                room,
                update({
                    limited: true,
                    required_state: [],
                    timeline: [message("$2"), message("$3")],
                    prev_batch: "t2",
                }),
                keepListState,
            );
            expect(room.timeline.map((event) => event.event_id)).toEqual(["$2", "$3"]);
            expect(room.prev_batch).toBe("t2");
        });

        it("is the new one when a timeline that does not carry on replaces what is kept", () => {
            let room = mergeRoomData(
                undefined,
                update({
                    initial: true,
                    limited: true,
                    required_state: [],
                    timeline: [message("$1")],
                    prev_batch: "t1",
                }),
                keepListState,
            );
            room = mergeRoomData(
                room,
                update({ limited: true, required_state: [], timeline: [message("$9")], prev_batch: "t9" }),
                keepListState,
            );
            expect(room.prev_batch).toBe("t9");
        });
    });

    it("takes the names and counts as the server last gave them", () => {
        let room = mergeRoomData(
            undefined,
            update({
                initial: true,
                required_state: [],
                timeline: [],
                name: "A",
                notification_count: 3,
                bump_stamp: 5,
            }),
            keepListState,
        );
        room = mergeRoomData(room, update({ required_state: [], timeline: [], notification_count: 0 }), keepListState);

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
        const store = new SlidingSyncCacheStore(ME);
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

        const next = new SlidingSyncCacheStore(ME);
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
        const store = new SlidingSyncCacheStore(ME);
        const sync = new FakeSlidingSync();
        store.record(sync as unknown as SlidingSync, client);
        rooms.set("!gone:example.org", { roomId: "!gone:example.org", accountData: new Map(), tags: {} });
        describeRoom(sync, "!gone:example.org", {});
        client.emit("Room.myMembership" as any, { roomId: "!gone:example.org" }, "leave");
        await store.save(client);

        const next = new SlidingSyncCacheStore(ME);
        expect(Object.keys((await next.loadFirst())?.rooms ?? {})).toEqual([]);
    });

    // The connection carries on from the cache, and the server does not send again what it sent before.
    it("hands the next session the position of the last response taken in whole", async () => {
        const store = new SlidingSyncCacheStore(ME);
        const sync = new FakeSlidingSync();
        store.record(sync as unknown as SlidingSync, client);
        sync.emit(SlidingSyncEvent.Lifecycle, SlidingSyncState.RequestFinished, { pos: "9" });
        sync.emit(SlidingSyncEvent.Lifecycle, SlidingSyncState.Complete, { pos: "8" });
        await store.save(client);

        expect((await new SlidingSyncCacheStore(ME).loadFirst())?.pos).toBe("8");
    });

    it("keeps every kind of a room's state but members it does not need", async () => {
        const store = new SlidingSyncCacheStore(ME);
        const sync = new FakeSlidingSync();
        store.record(sync as unknown as SlidingSync, client);
        rooms.set("!r:example.org", { roomId: "!r:example.org", accountData: new Map(), tags: {} });
        describeRoom(sync, "!r:example.org", {
            required_state: [
                state("m.room.topic"),
                state("m.room.pinned_events"),
                state("m.room.member", ME),
                state("m.room.member", "@other:x"),
            ],
        });
        await store.save(client);

        const kept = (await new SlidingSyncCacheStore(ME).loadFirst())!.rooms["!r:example.org"].required_state;
        expect(kept.map((event) => `${event.type}|${event.state_key}`).sort()).toEqual([
            `m.room.member|${ME}`,
            "m.room.pinned_events|",
            "m.room.topic|",
        ]);
    });

    it("keeps the cached account data when the session never reaches the server", async () => {
        const store = new SlidingSyncCacheStore(ME);
        const sync = new FakeSlidingSync();
        store.record(sync as unknown as SlidingSync, client);
        client.emit("accountData" as any, { getType: () => "m.push_rules", getContent: () => ({ global: {} }) });
        await store.save(client);

        const offline = new SlidingSyncCacheStore(ME);
        await offline.loadFirst();
        await offline.save(client);

        const next = new SlidingSyncCacheStore(ME);
        expect((await next.loadFirst())?.accountData.global).toEqual([
            { type: "m.push_rules", content: { global: {} } },
        ]);
    });
});
