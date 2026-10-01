/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    ClientEvent,
    type MatrixClient,
    MatrixEventEvent,
    RoomEvent,
    RoomStateEvent,
    SyncState,
    TypedEventEmitter,
} from "matrix-js-sdk/src/matrix";

import MatrixActionCreators from "./MatrixActionCreators";
import dis from "../dispatcher/dispatcher";
import { type ActionPayload } from "../dispatcher/payloads";
import { Action } from "../dispatcher/actions";

/**
 * At startup the saved sync is replayed into the client: thousands of timeline and state events, each of
 * which became a dispatch of its own, queued ahead of the one that tells the stores the client is ready
 * and of the one that opens the first room. No store has a client until then, so every one of them was
 * delivered to listeners that ignored it - and the first screen waited for all of it.
 */
describe("MatrixActionCreators", () => {
    let client: TypedEventEmitter<any, any> & { getSyncState: () => SyncState | null };
    let syncState: SyncState | null;
    let delivered: string[];
    let dispatcherRef: string;

    const room = { roomId: "!room:server", getUnfilteredTimelineSet: () => timelineSet };
    const timelineSet = {};
    const event = { getRoomId: () => room.roomId, getType: () => "m.room.message", getContent: () => ({}) };
    const timelineData = { liveEvent: false, timeline: { getTimelineSet: () => timelineSet } };

    /** Everything the client says about one room while it takes in a sync. */
    function emitRoomContents(): void {
        client.emit(ClientEvent.Room, room);
        client.emit(RoomStateEvent.Events, event, {}, null);
        client.emit(RoomEvent.Timeline, event, room, false, false, timelineData);
        client.emit(RoomEvent.Receipt, event, room);
        client.emit(RoomEvent.Tags, event, room);
        client.emit(RoomEvent.AccountData, event, room);
        client.emit(RoomEvent.MyMembership, room, "join", "invite");
        client.emit(MatrixEventEvent.Decrypted, event);
    }

    function setSyncState(state: SyncState): void {
        const previous = syncState;
        syncState = state;
        client.emit(ClientEvent.Sync, state, previous);
    }

    beforeEach(() => {
        vi.useFakeTimers();
        syncState = null;
        client = Object.assign(new TypedEventEmitter<any, any>(), { getSyncState: () => syncState });
        delivered = [];
        dispatcherRef = dis.register((payload: ActionPayload) => {
            delivered.push(payload.action);
        });
        MatrixActionCreators.start(client as unknown as MatrixClient);
    });

    afterEach(() => {
        MatrixActionCreators.stop();
        dis.unregister(dispatcherRef);
        vi.useRealTimers();
    });

    it("dispatches nothing about a room's contents while the saved sync is being replayed", () => {
        emitRoomContents();
        vi.runAllTimers();

        expect(delivered).toEqual([]);
    });

    it("leaves nothing queued ahead of the first room being opened", () => {
        for (let i = 0; i < 500; i++) emitRoomContents();
        setSyncState(SyncState.Prepared);
        dis.dispatch({ action: Action.ViewRoom, room_id: room.roomId });
        vi.runAllTimers();

        // The stores hear that the client is ready, and the room is opened: nothing comes before either.
        expect(delivered).toEqual(["MatrixActions.sync", Action.ViewRoom]);
    });

    it("still dispatches account data during the replay: the identity server is read from it", () => {
        client.emit(ClientEvent.AccountData, { getType: () => "m.identity_server", getContent: () => ({}) }, undefined);
        vi.runAllTimers();

        expect(delivered).toEqual(["MatrixActions.accountData"]);
    });

    it("dispatches everything once the client has reached a sync state", () => {
        setSyncState(SyncState.Prepared);
        emitRoomContents();
        vi.runAllTimers();

        expect(delivered).toEqual([
            "MatrixActions.sync",
            "MatrixActions.Room",
            "MatrixActions.RoomState.events",
            "MatrixActions.Room.timeline",
            "MatrixActions.Room.receipt",
            "MatrixActions.Room.tags",
            "MatrixActions.Room.accountData",
            "MatrixActions.Room.myMembership",
            "MatrixActions.Event.decrypted",
        ]);
    });

    it.each([SyncState.Catchup, SyncState.Reconnecting, SyncState.Error, SyncState.Syncing])(
        "keeps dispatching while the sync state is %s: only the time before the first state is the replay",
        (state) => {
            setSyncState(SyncState.Prepared);
            setSyncState(state);
            vi.runAllTimers();
            delivered.length = 0;

            emitRoomContents();
            vi.runAllTimers();

            expect(delivered).toHaveLength(8);
        },
    );

    it("dispatches as before for a client that cannot say what its sync state is", () => {
        MatrixActionCreators.stop();
        const bare = new TypedEventEmitter<any, any>();
        MatrixActionCreators.start(bare as unknown as MatrixClient);

        bare.emit(RoomEvent.Timeline, event, room, false, false, timelineData);
        vi.runAllTimers();

        expect(delivered).toEqual(["MatrixActions.Room.timeline"]);
    });
});
