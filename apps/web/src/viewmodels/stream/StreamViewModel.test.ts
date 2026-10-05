/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    Direction,
    EventType,
    KnownMembership,
    Room,
    RoomEvent,
    type EventTimeline,
    type MatrixClient,
    type MatrixEvent,
} from "matrix-js-sdk/src/matrix";
import { createTestClient, mkEvent, mkMessage } from "test-utils";

import { StreamViewModel } from "./StreamViewModel";

const ME = "@userId:matrix.org";
const ALICE = "@alice:x";

function addLive(room: Room, ...events: MatrixEvent[]): void {
    for (const event of events) room.getLiveTimeline().addEvent(event, { toStartOfTimeline: false, addToState: false });
}

function message(room: Room, ts: number, user = ALICE): MatrixEvent {
    return mkMessage({ room: room.roomId, user, ts, msg: `${room.roomId} at ${ts}`, event: true });
}

describe("StreamViewModel", () => {
    let client: MatrixClient;
    let rooms: Room[];
    let vm: StreamViewModel | undefined;

    function makeRoom(roomId: string, opts: { canPaginateBack?: boolean } = {}): Room {
        const room = new Room(roomId, client, ME);
        room.updateMyMembership(KnownMembership.Join);
        if (opts.canPaginateBack) room.getLiveTimeline().setPaginationToken(`tok-${roomId}`, Direction.Backward);
        rooms.push(room);
        return room;
    }

    /** The view model, once it has published its first rows (just after it is created). */
    function open(): StreamViewModel {
        const model = new StreamViewModel({ client });
        vi.advanceTimersByTime(16);
        return model;
    }

    /** The event rows as "room:ts", with a | before each run's first message. */
    function rows(model: StreamViewModel): string[] {
        return model
            .getSnapshot()
            .items.filter((i) => i.kind === "event")
            .map((i) => {
                const row = model.getRow(i.key)!;
                return `${row.runStart ? "|" : ""}${row.room.roomId}:${row.event.getTs()}`;
            });
    }

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        client = createTestClient();
        rooms = [];
        vi.mocked(client.getRooms).mockImplementation(() => rooms);
        vi.mocked(client.getRoom).mockImplementation((id) => rooms.find((r) => r.roomId === id) ?? null);
    });

    afterEach(() => {
        vm?.dispose();
        vm = undefined;
        vi.useRealTimers();
    });

    it("merges the rooms' messages by time, each run under its room", () => {
        const a = makeRoom("!a:x");
        const b = makeRoom("!b:x");
        addLive(a, message(a, 1000), message(a, 3000), message(a, 4000));
        addLive(b, message(b, 2000), message(b, 5000));

        vm = open();

        expect(rows(vm)).toEqual(["|!a:x:1000", "|!b:x:2000", "|!a:x:3000", "!a:x:4000", "|!b:x:5000"]);
    });

    it("publishes its first rows just after it is created, not while the view is mounting", () => {
        const a = makeRoom("!a:x");
        addLive(a, message(a, 1000));

        vm = new StreamViewModel({ client });
        // The shared timeline places the rows it is first given once; given at mount, a second mount loses them.
        expect(vm.getSnapshot().items).toEqual([]);

        vi.advanceTimersByTime(16);
        expect(rows(vm)).toEqual(["|!a:x:1000"]);
    });

    it("does not show a room's older messages while another room's messages of that time are not loaded", () => {
        const quiet = makeRoom("!quiet:x");
        const busy = makeRoom("!busy:x", { canPaginateBack: true });
        addLive(quiet, message(quiet, 1000));
        // A full first screen, so nothing is loaded before it is shown.
        for (let i = 0; i < 40; i++) addLive(busy, message(busy, 5000 + i));

        vm = open();

        // The busy room's history before 5000 is not loaded, so 1000 cannot be placed yet.
        expect(rows(vm).at(0)).toBe("|!busy:x:5000");
        expect(rows(vm)).not.toContain("|!quiet:x:1000");
        expect(client.paginateEventTimeline).not.toHaveBeenCalled();
    });

    it("pages back the room holding the list up, and shows the older messages once it is loaded", async () => {
        const quiet = makeRoom("!quiet:x");
        const busy = makeRoom("!busy:x", { canPaginateBack: true });
        addLive(quiet, message(quiet, 1000));
        addLive(busy, message(busy, 5000));
        vi.mocked(client.paginateEventTimeline).mockImplementation(async (timeline: EventTimeline) => {
            await Promise.resolve();
            // The page reaches the start of the busy room.
            timeline.addEvent(message(busy, 900), { toStartOfTimeline: true, addToState: false });
            timeline.setPaginationToken(null, Direction.Backward);
            return false;
        });

        vm = open();
        // Too few messages for a first screen: nothing is shown until the page is in.
        expect(vm.getSnapshot().items).toEqual([]);

        await vi.waitFor(() => expect(rows(vm!)).toEqual(["|!busy:x:900", "|!quiet:x:1000", "|!busy:x:5000"]));
        expect(client.paginateEventTimeline).toHaveBeenCalledWith(busy.getLiveTimeline(), {
            backwards: true,
            limit: 30,
        });
    });

    it("keeps loading while the reader is at the top, through a stretch with nothing to show", async () => {
        const quiet = makeRoom("!quiet:x");
        const busy = makeRoom("!busy:x", { canPaginateBack: true });
        addLive(quiet, message(quiet, 1000));
        // Enough for a first screen, so nothing is loaded before it is shown.
        for (let i = 0; i < 40; i++) addLive(busy, message(busy, 5000 + i));
        let calls = 0;
        vi.mocked(client.paginateEventTimeline).mockImplementation(async (timeline: EventTimeline) => {
            calls++;
            // More pages of changes to the room than one reach of the top goes through, then the room's start.
            if (calls <= 8) {
                const change = mkEvent({
                    type: EventType.RoomTopic,
                    room: busy.roomId,
                    user: ALICE,
                    ts: 4000 - calls,
                    event: true,
                    skey: "",
                    content: { topic: `t${calls}` },
                });
                timeline.addEvent(change, { toStartOfTimeline: true, addToState: false });
                return true;
            }
            timeline.addEvent(message(busy, 900), { toStartOfTimeline: true, addToState: false });
            timeline.setPaginationToken(null, Direction.Backward);
            return false;
        });
        vm = open();
        expect(rows(vm).at(0)).toBe("|!busy:x:5000");

        vm.onVisibleRangeChanged(0);
        vm.onStartReached();

        await vi.waitFor(() => {
            vi.advanceTimersByTime(16);
            expect(rows(vm!).slice(0, 2)).toEqual(["|!busy:x:900", "|!quiet:x:1000"]);
        });
    });

    it("stops asking a room whose pages do not move it", async () => {
        const quiet = makeRoom("!quiet:x");
        const stuck = makeRoom("!stuck:x", { canPaginateBack: true });
        addLive(quiet, message(quiet, 1000));
        addLive(stuck, message(stuck, 5000));
        // Each page brings nothing, only a different place to carry on from, as the stored history did.
        let page = 0;
        vi.mocked(client.paginateEventTimeline).mockImplementation(async (timeline: EventTimeline) => {
            timeline.setPaginationToken(`stored-${page++ % 3}`, Direction.Backward);
            return true;
        });

        vm = open();

        // Shown without the stuck room holding it up, after a few pages of it rather than a round of them each time.
        await vi.waitFor(() => expect(rows(vm!)).toEqual(["|!quiet:x:1000", "|!stuck:x:5000"]));
        expect(client.paginateEventTimeline).toHaveBeenCalledTimes(3);
    });

    it("does not let a room whose latest events are changes to it hold the list back past its last message", () => {
        const talking = makeRoom("!talking:x");
        const renamed = makeRoom("!renamed:x", { canPaginateBack: true });
        // Only a recent rename is loaded; the server says its last message was at 1000.
        addLive(
            renamed,
            mkEvent({
                type: EventType.RoomName,
                room: renamed.roomId,
                user: ALICE,
                ts: 1_700_000_009_000,
                event: true,
                skey: "",
                content: { name: "renamed" },
            }),
        );
        renamed.setBumpStamp(1_700_000_000_000);
        // A full first screen, all said before the rename and after the renamed room's last message.
        for (let i = 1; i <= 40; i++) addLive(talking, message(talking, 1_700_000_000_000 + i * 100));

        vm = open();

        // All of them are placed, with nothing paged: the rename does not hold the list at its own time.
        expect(rows(vm).filter((r) => r.includes("17000000"))).toHaveLength(40);
        expect(client.paginateEventTimeline).not.toHaveBeenCalled();
    });

    it("leaves out reactions and edits, also encrypted ones, and changes to the room", () => {
        const a = makeRoom("!a:x");
        const target = message(a, 1000);
        const reaction = mkEvent({
            type: EventType.Reaction,
            room: a.roomId,
            user: ALICE,
            ts: 2000,
            event: true,
            content: { "m.relates_to": { rel_type: "m.annotation", event_id: target.getId(), key: "👍" } },
        });
        const encryptedEdit = mkEvent({
            type: EventType.RoomMessageEncrypted,
            room: a.roomId,
            user: ALICE,
            ts: 3000,
            event: true,
            content: {
                "algorithm": "m.megolm.v1.aes-sha2",
                "ciphertext": "x",
                "m.relates_to": { rel_type: "m.replace", event_id: target.getId() },
            },
        });
        const topic = mkEvent({
            type: EventType.RoomTopic,
            room: a.roomId,
            user: ALICE,
            ts: 4000,
            event: true,
            skey: "",
            content: { topic: "t" },
        });
        addLive(a, target, reaction, encryptedEdit, topic);

        vm = open();

        expect(rows(vm)).toEqual(["|!a:x:1000"]);
    });

    it("leaves out rooms put aside as low priority", () => {
        const a = makeRoom("!a:x");
        const aside = makeRoom("!aside:x");
        aside.tags = { "m.lowpriority": {} };
        addLive(a, message(a, 1000));
        addLive(aside, message(aside, 2000));

        vm = open();

        expect(rows(vm)).toEqual(["|!a:x:1000"]);
    });

    it("adds a new message once the burst it came in has been taken in", () => {
        const a = makeRoom("!a:x");
        addLive(a, message(a, 1000));
        vm = open();

        const next = message(a, 2000);
        addLive(a, next);
        client.emit(RoomEvent.Timeline, next, a, false, false, { timeline: a.getLiveTimeline(), liveEvent: true });
        expect(rows(vm)).toEqual(["|!a:x:1000"]);

        vi.advanceTimersByTime(16);
        expect(rows(vm)).toEqual(["|!a:x:1000", "!a:x:2000"]);
    });

    it("keeps the row objects of messages that did not change, so they are not redrawn", () => {
        const a = makeRoom("!a:x");
        const b = makeRoom("!b:x");
        addLive(a, message(a, 1000));
        vm = open();
        const before = vm.getSnapshot().items.find((i) => i.kind === "event");

        const next = message(b, 2000);
        addLive(b, next);
        client.emit(RoomEvent.Timeline, next, b, false, false, { timeline: b.getLiveTimeline(), liveEvent: true });
        vi.advanceTimersByTime(16);

        expect(vm.getSnapshot().items.find((i) => i.kind === "event")).toBe(before);
    });
});
