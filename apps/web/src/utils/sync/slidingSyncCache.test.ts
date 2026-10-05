/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import { type IRoomEvent, type IStateEvent, type MatrixClient, MatrixEvent } from "matrix-js-sdk/src/matrix";
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
    fromNewestMessage,
    mergeRoomData,
    SlidingSyncCacheStore,
} from "./slidingSyncCache";
import { ROOM_LIST_STATE_TYPES } from "./roomListState";
import { clearServerPreviews, PREVIEW_FIELD, serverPreviewFor } from "./serverPreviews";

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

// Every session replays what is written: from the newest message on is what the chat needs (MEO-130).
describe("fromNewestMessage", () => {
    const status = (id: string): IRoomEvent => ({
        type: "com.beeper.message_send_status",
        event_id: id,
        sender: "@bot:example.org",
        origin_server_ts: 1,
        content: { "m.relates_to": { rel_type: "m.reference", event_id: "$x" } },
    });
    const room = (timeline: IRoomEvent[]) =>
        ({ required_state: [], timeline, prev_batch: "t_before_first", name: "Chat" }) as Parameters<
            typeof fromNewestMessage
        >[0];

    it("keeps the newest message and what came after it, and lets the token for before the first event go", () => {
        const kept = fromNewestMessage(
            room([message("$1"), status("$s1"), message("$2"), status("$s2"), status("$s3")]),
        );
        expect(kept.timeline.map((event) => event.event_id)).toEqual(["$2", "$s2", "$s3"]);
        expect(kept.prev_batch).toBeUndefined();
    });

    it("keeps a room whole when its first event is the newest message, or there is none", () => {
        const first = room([message("$1"), status("$s1")]);
        expect(fromNewestMessage(first)).toBe(first);
        const none = room([status("$s1"), status("$s2")]);
        expect(fromNewestMessage(none)).toBe(none);
    });

    it("is what the next session is handed", async () => {
        (globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory();
        await clearSlidingSyncCache();
        const client = Object.assign(new EventEmitter(), { getRoom: () => null }) as unknown as MatrixClient;
        const store = new SlidingSyncCacheStore(ME);
        const sync = new EventEmitter();
        store.record(sync as unknown as SlidingSync, client);
        sync.emit(SlidingSyncEvent.RoomData, "!r:example.org", {
            required_state: [],
            initial: true,
            prev_batch: "t_before_1",
            timeline: [message("$1"), message("$2"), status("$s")],
        });
        await store.save(client);

        const first = await new SlidingSyncCacheStore(ME).loadFirst();
        expect(first!.rooms["!r:example.org"].timeline.map((event) => event.event_id)).toEqual(["$2", "$s"]);
        expect(first!.rooms["!r:example.org"].prev_batch).toBeUndefined();
    });
});

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
        clearServerPreviews();
        client = Object.assign(new EventEmitter(), {
            getRoom: (roomId: string) => rooms.get(roomId) ?? null,
            getEventMapper: () => (event: IRoomEvent) => new MatrixEvent(event),
            decryptEventIfNeeded: async () => {},
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

    // A space has no messages, so no bump_stamp: by recency it came last, and the space bar filled in late.
    it("hands the next session every space with the first screen", async () => {
        const store = new SlidingSyncCacheStore(ME);
        const sync = new FakeSlidingSync();
        store.record(sync as unknown as SlidingSync, client);
        for (let i = 0; i < FIRST_ROOMS + 5; i++) {
            const roomId = `!r${i}:example.org`;
            rooms.set(roomId, { roomId, accountData: new Map(), tags: {} });
            describeRoom(sync, roomId, { bump_stamp: i + 1, timeline: [message(`$${i}`)] });
        }
        const spaceId = "!space:example.org";
        rooms.set(spaceId, { roomId: spaceId, accountData: new Map(), tags: {} });
        describeRoom(sync, spaceId, {
            required_state: [
                {
                    type: "m.room.create",
                    state_key: "",
                    content: { type: "m.space" },
                    sender: ME,
                    event_id: "$create",
                    origin_server_ts: 1,
                },
            ],
        });
        await store.save(client);

        const first = await new SlidingSyncCacheStore(ME).loadFirst();

        expect(Object.keys(first!.rooms)).toContain(spaceId);
    });

    // The badges are summed from every room: rooms with unread counts arriving in later batches made them count up
    // on every reload, though nothing had changed (MEO-140).
    it("hands the next session every room with something unread with the first screen", async () => {
        const store = new SlidingSyncCacheStore(ME);
        const sync = new FakeSlidingSync();
        store.record(sync as unknown as SlidingSync, client);
        for (let i = 0; i < FIRST_ROOMS + 5; i++) {
            const roomId = `!r${i}:example.org`;
            rooms.set(roomId, { roomId, accountData: new Map(), tags: {} });
            describeRoom(sync, roomId, { bump_stamp: 100 + i, timeline: [message(`$${i}`)] });
        }
        const counted = "!counted:example.org";
        const mentioned = "!mentioned:example.org";
        const marked = "!marked:example.org";
        const read = "!read:example.org";
        for (const roomId of [counted, mentioned, marked, read]) {
            rooms.set(roomId, { roomId, accountData: new Map(), tags: {} });
        }
        rooms.get(marked)!.accountData.set("m.marked_unread", {
            getType: () => "m.marked_unread",
            getContent: () => ({ unread: true }),
        });
        describeRoom(sync, counted, { bump_stamp: 1, notification_count: 3, timeline: [message("$c")] });
        describeRoom(sync, mentioned, { bump_stamp: 1, highlight_count: 1, timeline: [message("$m")] });
        describeRoom(sync, marked, { bump_stamp: 1, timeline: [message("$k")] });
        describeRoom(sync, read, { bump_stamp: 1, notification_count: 0, timeline: [message("$r")] });
        await store.save(client);

        const firstIds = Object.keys((await new SlidingSyncCacheStore(ME).loadFirst())!.rooms);

        expect(firstIds).toEqual(expect.arrayContaining([counted, mentioned, marked]));
        expect(firstIds).not.toContain(read);
    });

    it("keeps the message the server sent for the chat list, and hands it on now and in the next session", async () => {
        const store = new SlidingSyncCacheStore(ME);
        const sync = new FakeSlidingSync();
        store.record(sync as unknown as SlidingSync, client);
        rooms.set("!r:example.org", { roomId: "!r:example.org", accountData: new Map(), tags: {} });
        describeRoom(sync, "!r:example.org", {
            timeline: [message("$status")],
            [PREVIEW_FIELD]: message("$said"),
        } as Partial<MSC3575RoomData>);

        expect(serverPreviewFor("!r:example.org")?.getId()).toBe("$said");
        await store.save(client);

        clearServerPreviews();
        const next = new SlidingSyncCacheStore(ME);
        next.record(new FakeSlidingSync() as unknown as SlidingSync, client);
        const first = await next.loadFirst();
        expect((first!.rooms["!r:example.org"] as unknown as Record<string, unknown>)[PREVIEW_FIELD]).toMatchObject({
            event_id: "$said",
        });
        expect(serverPreviewFor("!r:example.org")?.getId()).toBe("$said");
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
    // The server once dated bridged chats by when the bridge made them (MEO-137). A resumed connection describes
    // only rooms that changed, so dates kept before the fix would have stayed: an older cache is not used.
    it("starts afresh from a cache kept in an older format", async () => {
        await new Promise<void>((resolve, reject) => {
            const request = indexedDB.open("mx-sliding-sync-cache", 1);
            request.onupgradeneeded = (): void => {
                request.result.createObjectStore("snapshots");
            };
            request.onsuccess = (): void => {
                const db = request.result;
                const tx = db.transaction("snapshots", "readwrite");
                tx.objectStore("snapshots").put(
                    { rooms: {}, accountData: { global: [], rooms: {} }, pos: "5" },
                    `${ME}:first`,
                );
                tx.oncomplete = (): void => {
                    db.close();
                    resolve();
                };
                tx.onerror = (): void => reject(tx.error);
            };
            request.onerror = (): void => reject(request.error);
        });

        const store = new SlidingSyncCacheStore(ME);
        expect(await store.loadFirst()).toBeNull();

        // ...and it is removed once the current format is written.
        await store.save(client);
        const old = await new Promise<unknown>((resolve, reject) => {
            const request = indexedDB.open("mx-sliding-sync-cache", 1);
            request.onsuccess = (): void => {
                const get = request.result.transaction("snapshots").objectStore("snapshots").get(`${ME}:first`);
                get.onsuccess = (): void => {
                    request.result.close();
                    resolve(get.result);
                };
                get.onerror = (): void => reject(get.error);
            };
            request.onerror = (): void => reject(request.error);
        });
        expect(old).toBeUndefined();
    });

    it("hands the next session the position of the last response taken in whole", async () => {
        const store = new SlidingSyncCacheStore(ME);
        const sync = new FakeSlidingSync();
        store.record(sync as unknown as SlidingSync, client);
        sync.emit(SlidingSyncEvent.Lifecycle, SlidingSyncState.RequestFinished, { pos: "9" });
        sync.emit(SlidingSyncEvent.Lifecycle, SlidingSyncState.Complete, { pos: "8" });
        await store.save(client);

        expect((await new SlidingSyncCacheStore(ME).loadFirst())?.pos).toBe("8");
    });

    // A room kept without its creation event counts as version 1, and the room offered an upgrade; a resumed
    // connection would never send the event again.
    it("has the next session start a new connection while a joined room is kept without its creation", async () => {
        const store = new SlidingSyncCacheStore(ME);
        const sync = new FakeSlidingSync();
        store.record(sync as unknown as SlidingSync, client);
        rooms.set("!whole:example.org", { roomId: "!whole:example.org", accountData: new Map(), tags: {} });
        rooms.set("!invited:example.org", { roomId: "!invited:example.org", accountData: new Map(), tags: {} });
        describeRoom(sync, "!whole:example.org", { required_state: [state("m.room.create")] });
        describeRoom(sync, "!invited:example.org", { invite_state: [state("m.room.name")] });
        sync.emit(SlidingSyncEvent.Lifecycle, SlidingSyncState.Complete, { pos: "8" });
        await store.save(client);
        // Rooms with all they need, and invites, which come with no state of their own: the connection carries on.
        expect((await new SlidingSyncCacheStore(ME).loadFirst())?.pos).toBe("8");

        // Described only by what changed, as a resumed connection does, with nothing kept of it before.
        rooms.set("!partial:example.org", { roomId: "!partial:example.org", accountData: new Map(), tags: {} });
        sync.emit(SlidingSyncEvent.RoomData, "!partial:example.org", update({ timeline: [message("$1")] }));
        await store.save(client);
        const next = await new SlidingSyncCacheStore(ME).loadFirst();
        expect(next?.pos).toBeUndefined();
        // The rooms are still shown at once.
        expect(Object.keys(next?.rooms ?? {}).sort()).toEqual([
            "!invited:example.org",
            "!partial:example.org",
            "!whole:example.org",
        ]);
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
