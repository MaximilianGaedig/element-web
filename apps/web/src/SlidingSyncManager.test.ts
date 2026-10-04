/*
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { vi, describe, it, expect, beforeEach } from "vitest";
import { type SlidingSync, SlidingSyncEvent, SlidingSyncState } from "matrix-js-sdk/src/sliding-sync";
import { ClientEvent, type MatrixClient, MatrixEvent, Room } from "matrix-js-sdk/src/matrix";
import fetchMock from "@fetch-mock/vitest";
import EventEmitter from "node:events";
import { waitFor } from "test-utils-rtl";
import { mkStubRoom, stubClient } from "test-utils";

import { LIST_TIMELINE_LIMIT, SlidingSyncManager } from "./SlidingSyncManager";

class MockSlidingSync extends EventEmitter {
    lists = {};
    listModifiedCount = 0;
    terminated = false;
    needsResend = false;
    modifyRoomSubscriptions = vi.fn();
    getRoomSubscriptions = vi.fn();
    useCustomSubscription = vi.fn();
    getListParams = vi.fn();
    setList = vi.fn();
    setListRanges = vi.fn();
    getListData = vi.fn();
    extensions = vi.fn();
    desiredRoomSubscriptions = vi.fn();
}

describe("SlidingSyncManager", () => {
    let manager: SlidingSyncManager;
    let slidingSync: SlidingSync;
    let client: MatrixClient;

    beforeEach(() => {
        slidingSync = new MockSlidingSync() as unknown as SlidingSync;
        manager = new SlidingSyncManager();
        client = stubClient();
        // by default the client has no rooms: stubClient magically makes rooms annoyingly.
        vi.mocked(client.getRoom).mockReturnValue(null);
        (manager as any).configure(client, "invalid");
        manager.slidingSync = slidingSync;
        fetchMock.get("https://proxy/client/server.json", {});
    });

    it("asks for enough of each chat's latest events to find the one the chat list shows", () => {
        const fresh = new SlidingSyncManager();
        (fresh as any).configure(client, "invalid");
        // A bridged chat's latest event is usually the delivery status of its last message.
        expect(LIST_TIMELINE_LIMIT).toBeGreaterThanOrEqual(5);
        for (const list of ["favourites", "dms", "untagged"]) {
            expect(fresh.slidingSync!.getListParams(list)?.timeline_limit).toBe(LIST_TIMELINE_LIMIT);
        }
    });

    it("asks for the state an open room shows, by type, for both kinds of room", () => {
        const fresh = new SlidingSyncManager();
        (fresh as any).configure(client, "invalid");
        const ss = fresh.slidingSync as any;
        const unencrypted: [string, string][] = ss.customSubscriptions.get("unencrypted").required_state;
        const encrypted: [string, string][] = ss.roomSubscriptionInfo.required_state;
        // Not by a "*" event type alone: a server that does not support one (tuwunel) sends none of these.
        for (const required of [unencrypted, encrypted]) {
            expect(required).toContainEqual(["m.room.pinned_events", ""]);
            expect(required).toContainEqual(["m.room.topic", ""]);
            expect(required).toContainEqual(["m.room.history_visibility", ""]);
            expect(required).toContainEqual(["io.element.widgets.layout", ""]);
        }
        // Encrypted rooms need every member to encrypt for; unencrypted ones load them lazily.
        expect(encrypted).toContainEqual(["m.room.member", "*"]);
        expect(unencrypted).not.toContainEqual(["m.room.member", "*"]);
        expect(unencrypted).toContainEqual(["m.room.member", "$LAZY"]);
    });

    describe("setRoomVisible", () => {
        it("adds a subscription for the room", async () => {
            const roomId = "!room:id";
            vi.mocked(client.getRoom).mockReturnValue(mkStubRoom(roomId, "foo", client));
            const subs = new Set<string>();
            vi.mocked(slidingSync.getRoomSubscriptions).mockReturnValue(subs);
            await manager.setRoomVisible(roomId);
            expect(slidingSync.modifyRoomSubscriptions).toHaveBeenCalledWith(new Set<string>([roomId]));
        });

        it("adds a custom subscription for a lazy-loadable room", async () => {
            const roomId = "!lazy:id";
            const room = new Room(roomId, client, client.getUserId()!);
            room.getLiveTimeline().initialiseState([
                new MatrixEvent({
                    type: "m.room.create",
                    state_key: "",
                    event_id: "$abc123",
                    sender: client.getUserId()!,
                    content: {
                        creator: client.getUserId()!,
                    },
                }),
            ]);
            vi.mocked(client.getRoom).mockImplementation((r?: string): Room | null => {
                if (roomId === r) {
                    return room;
                }
                return null;
            });
            const subs = new Set<string>();
            vi.mocked(slidingSync.getRoomSubscriptions).mockReturnValue(subs);
            await manager.setRoomVisible(roomId);
            expect(slidingSync.modifyRoomSubscriptions).toHaveBeenCalledWith(new Set<string>([roomId]));
            // we aren't prescriptive about what the sub name is.
            expect(slidingSync.useCustomSubscription).toHaveBeenCalledWith(roomId, expect.anything());
        });

        it("waits if the room is not yet known", async () => {
            const roomId = "!room:id";
            vi.mocked(client.getRoom).mockReturnValue(null);
            const subs = new Set<string>();
            vi.mocked(slidingSync.getRoomSubscriptions).mockReturnValue(subs);

            const setVisibleDone = vi.fn();
            manager.setRoomVisible(roomId).then(setVisibleDone);

            await waitFor(() => expect(client.getRoom).toHaveBeenCalledWith(roomId));

            expect(setVisibleDone).not.toHaveBeenCalled();

            const stubRoom = mkStubRoom(roomId, "foo", client);
            vi.mocked(client.getRoom).mockReturnValue(stubRoom);
            client.emit(ClientEvent.Room, stubRoom);

            await waitFor(() => expect(setVisibleDone).toHaveBeenCalled());
        });
    });

    describe("ensureListRegistered", () => {
        it("creates a new list based on the key", async () => {
            const listKey = "key";
            vi.mocked(slidingSync.getListParams).mockReturnValue(null);
            await manager.ensureListRegistered(listKey, {
                sort: ["by_recency"],
            });
            expect(slidingSync.setList).toHaveBeenCalledWith(
                listKey,
                expect.objectContaining({
                    sort: ["by_recency"],
                }),
            );
        });

        it("updates an existing list based on the key", async () => {
            const listKey = "key";
            vi.mocked(slidingSync.getListParams).mockReturnValue({
                ranges: [[0, 42]],
            });
            await manager.ensureListRegistered(listKey, {
                sort: ["by_recency"],
            });
            expect(slidingSync.setList).toHaveBeenCalledWith(
                listKey,
                expect.objectContaining({
                    sort: ["by_recency"],
                    ranges: [[0, 42]],
                }),
            );
        });

        it("updates ranges on an existing list based on the key if there's no other changes", async () => {
            const listKey = "key";
            vi.mocked(slidingSync.getListParams).mockReturnValue({
                ranges: [[0, 42]],
            });
            await manager.ensureListRegistered(listKey, {
                ranges: [[0, 52]],
            });
            expect(slidingSync.setList).not.toHaveBeenCalled();
            expect(slidingSync.setListRanges).toHaveBeenCalledWith(listKey, [[0, 52]]);
        });

        it("no-ops for idential changes", async () => {
            const listKey = "key";
            vi.mocked(slidingSync.getListParams).mockReturnValue({
                ranges: [[0, 42]],
                sort: ["by_recency"],
            });
            await manager.ensureListRegistered(listKey, {
                ranges: [[0, 42]],
                sort: ["by_recency"],
            });
            expect(slidingSync.setList).not.toHaveBeenCalled();
            expect(slidingSync.setListRanges).not.toHaveBeenCalled();
        });
    });

    describe("startSpidering", () => {
        it("requests in expanding batchSizes", async () => {
            const gapMs = 1;
            const batchSize = 10;
            vi.mocked(slidingSync.getListData).mockImplementation((key) => {
                return {
                    joinedCount: 64,
                    roomIndexToRoomId: {},
                };
            });
            await (manager as any).startSpidering(slidingSync, batchSize, gapMs);

            // we expect calls for 10,19 -> 20,29 -> 30,39 -> 40,49 -> 50,59 -> 60,69
            const wantWindows = [
                [0, 10],
                [0, 20],
                [0, 30],
                [0, 40],
                [0, 50],
                [0, 60],
                [0, 70],
            ];

            for (let i = 1; i < wantWindows.length; ++i) {
                // each time we emit, it should expand the range of all 5 lists by 10 until
                // they all include all the rooms (64), which is 6 emits.
                slidingSync.emit(SlidingSyncEvent.Lifecycle, SlidingSyncState.Complete, null, undefined);
                await waitFor(() => expect(slidingSync.getListData).toHaveBeenCalledTimes(i * 5));
                expect(slidingSync.setListRanges).toHaveBeenCalledTimes(i * 5);
                expect(slidingSync.setListRanges).toHaveBeenCalledWith("spaces", [wantWindows[i]]);
            }
        });
        // Grown a moment later, the ranges aborted the long-poll already sent - which the server had answered - and
        // the request sent again from the same position made it send every room in full again.
        it("grows the ranges at once, while no request is out", async () => {
            vi.mocked(slidingSync.getListData).mockReturnValue({ joinedCount: 64 });
            await (manager as any).startSpidering(slidingSync, 10, 50);

            slidingSync.emit(SlidingSyncEvent.Lifecycle, SlidingSyncState.Complete, null, undefined);

            // No await: before the SDK goes on to build the next request.
            expect(slidingSync.setListRanges).toHaveBeenCalledWith("untagged", [[0, 20]]);
        });

        /* Every start grew the lists from ten again, one request at a time, a second each for 700 chats. */
        it("keeps each list's size once they are whole, and the next session starts each list there", async () => {
            vi.mocked(slidingSync.getListData).mockReturnValue({ joinedCount: 704 });
            vi.mocked(slidingSync.getListParams).mockReturnValue({ ranges: [[0, 710]] } as any);
            await (manager as any).startSpidering(slidingSync, 50, 1);

            slidingSync.emit(SlidingSyncEvent.Lifecycle, SlidingSyncState.Complete, null, undefined);

            expect(slidingSync.setListRanges).not.toHaveBeenCalled();
            const next = new SlidingSyncManager();
            (next as any).configure(client, "invalid");
            expect(next.slidingSync!.getListParams("untagged")?.ranges).toEqual([[0, 704]]);
            localStorage.clear();
        });

        it("handles accounts with zero rooms", async () => {
            const gapMs = 1;
            const batchSize = 10;
            vi.mocked(slidingSync.getListData).mockImplementation((key) => {
                return {
                    joinedCount: 0,
                    roomIndexToRoomId: {},
                };
            });
            await (manager as any).startSpidering(slidingSync, batchSize, gapMs);
            slidingSync.emit(SlidingSyncEvent.Lifecycle, SlidingSyncState.Complete, null, undefined);
            await waitFor(() => expect(slidingSync.getListData).toHaveBeenCalledTimes(5));
            // should not have needed to expand the range
            expect(slidingSync.setListRanges).not.toHaveBeenCalled();
        });
    });
    describe("checkSupport", () => {
        beforeEach(() => {
            SlidingSyncManager.serverSupportsSlidingSync = false;
        });
        it("shorts out if the server has 'native' sliding sync support", async () => {
            vi.spyOn(manager, "nativeSlidingSyncSupport").mockResolvedValue(true);
            expect(SlidingSyncManager.serverSupportsSlidingSync).toBeFalsy();
            await manager.checkSupport(client);
            expect(SlidingSyncManager.serverSupportsSlidingSync).toBeTruthy();
        });
    });
    describe("setup", () => {
        let untypedManager: any;

        beforeEach(() => {
            untypedManager = manager;
            vi.spyOn(untypedManager, "configure");
            vi.spyOn(untypedManager, "startSpidering");
        });
        it("uses the baseUrl", async () => {
            await manager.setup(client);
            expect(untypedManager.configure).toHaveBeenCalled();
            expect(untypedManager.configure).toHaveBeenCalledWith(client, client.baseUrl);
            expect(untypedManager.startSpidering).toHaveBeenCalled();
        });
    });
});
