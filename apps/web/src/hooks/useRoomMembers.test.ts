/*
Copyright 2024 New Vector Ltd.
Copyright 2023 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from "vitest";
import { waitFor, renderHook, act } from "test-utils-rtl";
import { type MatrixClient, MatrixEvent, Room } from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";
import { stubClient } from "test-utils";

import { MatrixClientPeg } from "../MatrixClientPeg";
import { useMyRoomMembership, useRoomMemberCount, useRoomMembers } from "./useRoomMembers";

describe("useRoomMembers", () => {
    function render(room: Room) {
        return renderHook(() => useRoomMembers(room));
    }

    let cli: MatrixClient;
    let room: Room;

    beforeEach(() => {
        stubClient();
        cli = MatrixClientPeg.safeGet();
        room = new Room("!room:server", cli, cli.getSafeUserId());
    });

    it("should update on RoomState.Members events", async () => {
        const { result } = render(room);

        expect(result.current).toHaveLength(0);

        act(() => {
            room.currentState.markOutOfBandMembersStarted();
            room.currentState.setOutOfBandMembers([
                new MatrixEvent({
                    type: "m.room.member",
                    state_key: "!user:server",
                    room_id: room.roomId,
                    content: {
                        membership: KnownMembership.Join,
                    },
                }),
            ]);
        });
        await waitFor(() => expect(result.current).toHaveLength(1));
    });
});

describe("useRoomMemberCount", () => {
    function render(room: Room) {
        return renderHook(() => useRoomMemberCount(room));
    }

    let cli: MatrixClient;
    let room: Room;

    beforeEach(() => {
        stubClient();
        cli = MatrixClientPeg.safeGet();
        room = new Room("!room:server", cli, cli.getSafeUserId());
    });

    /* A bridged group counted the bridge's bot as one of its people. */
    it("leaves the bridge's bot out of the count", () => {
        const member = (userId: string): MatrixEvent =>
            new MatrixEvent({
                type: "m.room.member",
                state_key: userId,
                sender: userId,
                room_id: room.roomId,
                content: { membership: KnownMembership.Join },
                event_id: `$${userId}`,
            });
        room.currentState.setStateEvents([
            member("@ada:server"),
            member("@bob:server"),
            member("@bot:server"),
            new MatrixEvent({
                type: "m.bridge",
                state_key: "net",
                sender: "@bot:server",
                room_id: room.roomId,
                content: { bridgebot: "@bot:server" },
                event_id: "$bridge",
            }),
        ]);

        const { result } = render(room);

        expect(result.current).toBe(2);
    });

    it("should update on RoomState.Members events", async () => {
        const { result } = render(room);

        expect(result.current).toBe(0);

        act(() => {
            room.currentState.markOutOfBandMembersStarted();
            room.currentState.setOutOfBandMembers([
                new MatrixEvent({
                    type: "m.room.member",
                    state_key: "!user:server",
                    room_id: room.roomId,
                    content: {
                        membership: KnownMembership.Join,
                    },
                }),
            ]);
        });
        await waitFor(() => expect(result.current).toBe(1));
    });
});

describe("useMyRoomMembership", () => {
    function render(room: Room) {
        return renderHook(() => useMyRoomMembership(room));
    }

    let cli: MatrixClient;
    let room: Room;

    beforeEach(() => {
        stubClient();
        cli = MatrixClientPeg.safeGet();
        room = new Room("!room:server", cli, cli.getSafeUserId());
    });

    it("should update on RoomState.Members events", async () => {
        room.updateMyMembership(KnownMembership.Join);
        const { result } = render(room);

        expect(result.current).toBe(KnownMembership.Join);

        act(() => {
            room.updateMyMembership(KnownMembership.Leave);
        });
        await waitFor(() => expect(result.current).toBe(KnownMembership.Leave));
    });
});
