/*
Copyright 2024 New Vector Ltd.
Copyright 2023 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import { ClientEvent, type MatrixClient, Room } from "matrix-js-sdk/src/matrix";
import { createTestClient, flushPromises, setupAsyncStoreWithClient } from "test-utils";

import SettingsStore from "../settings/SettingsStore";
import { BreadcrumbsStore } from "./BreadcrumbsStore";
import { Action } from "../dispatcher/actions";
import defaultDispatcher from "../dispatcher/dispatcher";
import { SettingLevel } from "../settings/SettingLevel";

describe("BreadcrumbsStore", () => {
    let store: BreadcrumbsStore;
    const client: MatrixClient = createTestClient();

    beforeEach(() => {
        store = BreadcrumbsStore.instance;
        setupAsyncStoreWithClient(store, client);
        vi.spyOn(SettingsStore, "setValue").mockImplementation(() => Promise.resolve());
        vi.spyOn(SettingsStore, "getValue").mockReturnValue(false);
    });

    afterEach(() => {
        vi.resetAllMocks();
    });

    describe("If the feature_dynamic_room_predecessors is not enabled", () => {
        beforeEach(() => {
            vi.spyOn(SettingsStore, "getValue").mockReturnValue(false);
        });

        it("Appends a room when you join", async () => {
            // Sanity: no rooms initially
            expect(store.rooms).toEqual([]);

            // Given a room
            const room = fakeRoom();
            vi.mocked(client.getRoom).mockReturnValue(room);
            vi.mocked(client.getRoomUpgradeHistory).mockReturnValue([]);

            // When we hear that we have joined it
            await dispatchJoinRoom(room.roomId);

            // It is stored in the store's room list
            expect(store.rooms.map((r) => r.roomId)).toEqual([room.roomId]);
        });

        it("Replaces the old room when a newer one joins", async () => {
            // Given an old room and a new room
            const oldRoom = fakeRoom();
            const newRoom = fakeRoom();
            vi.mocked(client.getRoom).mockImplementation((roomId) => {
                if (roomId === oldRoom.roomId) return oldRoom;
                return newRoom;
            });
            // Where the new one is a predecessor of the old one
            vi.mocked(client.getRoomUpgradeHistory).mockReturnValue([oldRoom, newRoom]);

            // When we hear that we joined the old room, then the new one
            await dispatchJoinRoom(oldRoom.roomId);
            await dispatchJoinRoom(newRoom.roomId);

            // The store only has the new one
            expect(store.rooms.map((r) => r.roomId)).toEqual([newRoom.roomId]);
        });

        it("Passes through the dynamic predecessor setting", async () => {
            // Given a room
            const room = fakeRoom();
            vi.mocked(client.getRoom).mockReturnValue(room);
            vi.mocked(client.getRoomUpgradeHistory).mockReturnValue([]);

            // When we signal that we have joined
            await dispatchJoinRoom(room.roomId);

            // We pass the value of the dynamic predecessor setting through
            expect(client.getRoomUpgradeHistory).toHaveBeenCalledWith(room.roomId, true, false);
        });
    });

    describe("If the feature_dynamic_room_predecessors is enabled", () => {
        beforeEach(() => {
            // Turn on feature_dynamic_room_predecessors setting
            vi.spyOn(SettingsStore, "getValue").mockImplementation(
                (settingName) => settingName === "feature_dynamic_room_predecessors",
            );
        });

        it("Passes through the dynamic predecessor setting", async () => {
            // Given a room
            const room = fakeRoom();
            vi.mocked(client.getRoom).mockReturnValue(room);
            vi.mocked(client.getRoomUpgradeHistory).mockReturnValue([]);

            // When we signal that we have joined
            await dispatchJoinRoom(room.roomId);

            // We pass the value of the dynamic predecessor setting through
            expect(client.getRoomUpgradeHistory).toHaveBeenCalledWith(room.roomId, true, true);
        });
    });

    // Sliding sync sends rooms a batch at a time: the store is ready before every room it names has arrived.
    describe("With saved rooms that arrive after the store is ready", () => {
        const early = new Room("!early:example.com", client, "@user:example.com");
        const late = new Room("!late:example.com", client, "@user:example.com");
        let arrived: Room[];

        beforeEach(async () => {
            arrived = [early];
            vi.spyOn(SettingsStore, "getValue").mockImplementation((settingName) =>
                settingName === "breadcrumb_rooms" ? [early.roomId, late.roomId] : false,
            );
            vi.mocked(client.getRoom).mockImplementation((roomId) => arrived.find((r) => r.roomId === roomId) ?? null);
            vi.mocked(client.getRoomUpgradeHistory).mockReturnValue([]);
            await setupAsyncStoreWithClient(store, client);
        });

        it("Shows a saved room once it arrives", async () => {
            expect(store.rooms.map((r) => r.roomId)).toEqual([early.roomId]);

            arrived.push(late);
            client.emit(ClientEvent.Room, late);
            await flushPromises();

            expect(store.rooms.map((r) => r.roomId)).toEqual([early.roomId, late.roomId]);
        });

        it("Keeps saved rooms that have not arrived when a room is added", async () => {
            const joined = new Room("!joined:example.com", client, "@user:example.com");
            arrived.push(joined);

            await dispatchJoinRoom(joined.roomId);

            expect(SettingsStore.setValue).toHaveBeenCalledWith("breadcrumb_rooms", null, SettingLevel.ACCOUNT, [
                joined.roomId,
                early.roomId,
                late.roomId,
            ]);
        });
    });

    /**
     * Send a JoinRoom event via the dispatcher, and wait for it to process.
     */
    async function dispatchJoinRoom(roomId: string) {
        defaultDispatcher.dispatch(
            {
                action: Action.JoinRoom,
                roomId,
                metricsTrigger: null,
            },
            true, // synchronous dispatch
        );

        // Wait for event dispatch to happen
        await flushPromises();
    }

    let roomIdx = 0;

    function fakeRoom(): Room {
        roomIdx++;
        return new Room(`room${roomIdx}`, client, "@user:example.com");
    }
});
