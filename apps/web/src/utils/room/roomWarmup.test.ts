/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    Direction,
    type EventTimeline,
    LOCAL_PAGINATION_PREFIX,
    type MatrixClient,
    PendingEventOrdering,
    Room,
} from "matrix-js-sdk/src/matrix";
import { createTestClient, mkMessage } from "test-utils";

import {
    RoomWarmup,
    WARMUP_REST_MS,
    WARMUP_SERVER_ROOMS_PER_MINUTE,
    type WarmupHistory,
    wantsWarmup,
    warmUpRoom,
    warmupAllowance,
} from "./roomWarmup";

const USER_ID = "@alice:example.org";
const STORED_TOKEN = LOCAL_PAGINATION_PREFIX + "$first";
const SERVER_TOKEN = "t-server";

describe("roomWarmup", () => {
    let client: MatrixClient;
    /** What was asked for, in order: "state", then "store" or "server" per batch of history. */
    let asked: string[];

    const makeRoom = (name: string, events: number, token: string | null): Room => {
        const room = new Room(`!${name}:example.org`, client, USER_ID, {
            pendingEventOrdering: PendingEventOrdering.Detached,
        });
        for (let i = 0; i < events; i++) {
            const event = mkMessage({ room: room.roomId, user: USER_ID, event: true, id: `$${name}${i}` });
            room.getUnfilteredTimelineSet().addLiveEvent(event, { addToState: false });
        }
        room.getLiveTimeline().setPaginationToken(token, Direction.Backward);
        return room;
    };

    beforeEach(() => {
        vi.useFakeTimers();
        asked = [];
        client = createTestClient();
        Object.assign(client, {
            hasFullRoomState: vi.fn().mockReturnValue(true),
            loadStoredRoomState: vi.fn(async () => {
                asked.push("state");
            }),
        });
        // The store answers with what the replay left out and where the server continues; the
        // server with a batch that, for these tests, is the last of the room.
        vi.mocked(client.paginateEventTimeline).mockImplementation(async (timeline: EventTimeline) => {
            const stored = timeline.getPaginationToken(Direction.Backward)?.startsWith(LOCAL_PAGINATION_PREFIX);
            asked.push(stored ? "store" : "server");
            timeline.setPaginationToken(stored ? SERVER_TOKEN : null, Direction.Backward);
            return true;
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    describe("warmupAllowance", () => {
        const none: WarmupHistory = { inFlight: null, warmed: new Set(), serverRequests: [] };

        it("allows a room nothing has been done for, as far as the server", () => {
            expect(warmupAllowance(none, "!a", 0)).toEqual({ start: true, server: true });
        });

        it("warms one room at a time", () => {
            expect(warmupAllowance({ ...none, inFlight: "!b" }, "!a", 0)).toEqual({ start: false, server: false });
        });

        it("warms a room once", () => {
            expect(warmupAllowance({ ...none, warmed: new Set(["!a"]) }, "!a", 0).start).toBe(false);
            expect(warmupAllowance({ ...none, warmed: new Set(["!a"]) }, "!b", 0).start).toBe(true);
        });

        it("asks the server for only a few rooms a minute, and still reads the store for the rest", () => {
            const serverRequests = Array.from({ length: WARMUP_SERVER_ROOMS_PER_MINUTE }, (_, i) => i * 1000);

            expect(warmupAllowance({ ...none, serverRequests: serverRequests.slice(1) }, "!a", 10_000).server).toBe(
                true,
            );
            expect(warmupAllowance({ ...none, serverRequests }, "!a", 10_000)).toEqual({ start: true, server: false });
        });

        it("counts only the last minute", () => {
            const serverRequests = Array.from({ length: WARMUP_SERVER_ROOMS_PER_MINUTE }, (_, i) => i * 1000);

            // The oldest was at 0: a minute on, there is room for one more.
            expect(warmupAllowance({ ...none, serverRequests }, "!a", 59_999).server).toBe(false);
            expect(warmupAllowance({ ...none, serverRequests }, "!a", 60_000).server).toBe(true);
        });
    });

    describe("wantsWarmup", () => {
        it("leaves alone a room with nothing more behind it", () => {
            expect(wantsWarmup(client, makeRoom("whole", 3, null))).toBe(false);
        });

        it("leaves alone a room that already has enough to open with", () => {
            expect(wantsWarmup(client, makeRoom("long", 40, SERVER_TOKEN))).toBe(false);
        });

        it("wants a room with history in the store", () => {
            expect(wantsWarmup(client, makeRoom("stored", 40, STORED_TOKEN))).toBe(true);
        });

        it("wants a room with state in the store", () => {
            vi.mocked(client.hasFullRoomState).mockReturnValue(false);
            expect(wantsWarmup(client, makeRoom("trimmed", 40, null))).toBe(true);
        });

        it("wants a short room with more on the server", () => {
            expect(wantsWarmup(client, makeRoom("short", 20, SERVER_TOKEN))).toBe(true);
        });
    });

    describe("warmUpRoom", () => {
        it("brings in the stored state, then the stored history, then the server's", async () => {
            await warmUpRoom(client, makeRoom("a", 3, STORED_TOKEN), () => true);
            expect(asked).toEqual(["state", "store", "server"]);
        });

        it("stops short of the server when told to", async () => {
            await warmUpRoom(client, makeRoom("a", 3, STORED_TOKEN), () => false);
            expect(asked).toEqual(["state", "store"]);
        });

        it("asks the server for nothing when the room has enough to open with", async () => {
            const mayAskServer = vi.fn().mockReturnValue(true);
            await warmUpRoom(client, makeRoom("a", 40, STORED_TOKEN), mayAskServer);
            expect(asked).toEqual(["state", "store"]);
            // Not even asked: it would have counted against the ration.
            expect(mayAskServer).not.toHaveBeenCalled();
        });
    });

    describe("RoomWarmup", () => {
        let warmup: RoomWarmup;

        beforeEach(() => {
            warmup = new RoomWarmup(client);
        });

        it("starts once the pointer has rested on the room", async () => {
            warmup.rest(makeRoom("a", 3, STORED_TOKEN));

            await vi.advanceTimersByTimeAsync(WARMUP_REST_MS - 1);
            expect(asked).toEqual([]);
            await vi.advanceTimersByTimeAsync(1);
            expect(asked).toEqual(["state", "store", "server"]);
        });

        it("does nothing for a room the pointer only crossed", async () => {
            const room = makeRoom("a", 3, STORED_TOKEN);
            warmup.rest(room);
            await vi.advanceTimersByTimeAsync(WARMUP_REST_MS - 1);
            warmup.leave(room);

            await vi.advanceTimersByTimeAsync(10 * WARMUP_REST_MS);
            expect(asked).toEqual([]);
        });

        it("follows the pointer to the room it ends up on", async () => {
            const passed = makeRoom("passed", 3, STORED_TOKEN);
            const reached = makeRoom("reached", 3, null);
            vi.mocked(client.hasFullRoomState).mockImplementation((roomId) => roomId !== reached.roomId);
            warmup.rest(passed);
            warmup.rest(reached);

            await vi.advanceTimersByTimeAsync(WARMUP_REST_MS);
            expect(client.loadStoredRoomState).toHaveBeenCalledExactlyOnceWith(reached.roomId);
        });

        it("starts at once when told the rest is already over (a finger landing on the room)", async () => {
            warmup.rest(makeRoom("a", 3, STORED_TOKEN), 0);

            await vi.advanceTimersByTimeAsync(0);
            expect(asked).toEqual(["state", "store", "server"]);
        });

        it("does not ask the server for a room the pointer has left by then", async () => {
            const room = makeRoom("a", 3, STORED_TOKEN);
            // The pointer moves off while the store is being read.
            vi.mocked(client.loadStoredRoomState).mockImplementation(async () => {
                asked.push("state");
                warmup.leave(room);
            });
            warmup.rest(room);

            await vi.advanceTimersByTimeAsync(WARMUP_REST_MS);
            expect(asked).toEqual(["state", "store"]);
        });

        it("leaves alone a room that needs nothing", async () => {
            warmup.rest(makeRoom("a", 40, SERVER_TOKEN));

            await vi.advanceTimersByTimeAsync(WARMUP_REST_MS);
            expect(asked).toEqual([]);
        });

        it("warms a room once", async () => {
            const room = makeRoom("a", 3, STORED_TOKEN);
            // A server that never runs out, so the room would otherwise want warming up again.
            vi.mocked(client.paginateEventTimeline).mockImplementation(async (timeline: EventTimeline) => {
                asked.push("history");
                timeline.setPaginationToken(SERVER_TOKEN, Direction.Backward);
                return true;
            });
            warmup.rest(room);
            await vi.advanceTimersByTimeAsync(WARMUP_REST_MS);
            warmup.leave(room);
            asked = [];

            warmup.rest(room);
            await vi.advanceTimersByTimeAsync(WARMUP_REST_MS);
            expect(asked).toEqual([]);
        });

        it("warms one room at a time", async () => {
            const first = makeRoom("first", 3, STORED_TOKEN);
            const second = makeRoom("second", 3, STORED_TOKEN);
            // The first room's store read stays out.
            vi.mocked(client.loadStoredRoomState).mockImplementation((roomId) => {
                asked.push(`state ${roomId}`);
                return new Promise(() => {});
            });
            warmup.rest(first);
            await vi.advanceTimersByTimeAsync(WARMUP_REST_MS);

            warmup.rest(second);
            await vi.advanceTimersByTimeAsync(WARMUP_REST_MS);
            expect(asked).toEqual([`state ${first.roomId}`]);
        });

        it("asks the server for only a few rooms a minute", async () => {
            for (let i = 0; i < WARMUP_SERVER_ROOMS_PER_MINUTE + 2; i++) {
                warmup.rest(makeRoom(`room${i}`, 3, SERVER_TOKEN));
                await vi.advanceTimersByTimeAsync(WARMUP_REST_MS);
            }
            expect(asked.filter((what) => what === "server")).toHaveLength(WARMUP_SERVER_ROOMS_PER_MINUTE);

            // A minute later the ration is back.
            await vi.advanceTimersByTimeAsync(60_000);
            warmup.rest(makeRoom("later", 3, SERVER_TOKEN));
            await vi.advanceTimersByTimeAsync(WARMUP_REST_MS);
            expect(asked.filter((what) => what === "server")).toHaveLength(WARMUP_SERVER_ROOMS_PER_MINUTE + 1);
        });
    });
});
