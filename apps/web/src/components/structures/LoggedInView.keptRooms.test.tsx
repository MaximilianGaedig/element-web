/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import React from "react";
import { act, render } from "test-utils-rtl";
import { MediaHandler } from "matrix-js-sdk/src/webrtc/mediaHandler";
import { KnownMembership } from "matrix-js-sdk/src/types";
import { PushProcessor } from "matrix-js-sdk/src/pushprocessor";
import {
    getMockClientWithEventEmitter,
    mockClientMethodsRooms,
    mockClientMethodsServer,
    mockClientMethodsUser,
    TestSDKContext,
} from "test-utils";

import LoggedInView from "./LoggedInView";
import { SDKContext } from "../../contexts/SDKContext";
import ResizeNotifier from "../../utils/ResizeNotifier";
import SettingsStore from "../../settings/SettingsStore";
import { roomsAhead } from "../../utils/room/roomsAhead";
import { resetSwitchTimings, switchTimings } from "../../utils/room/switchTimings";
import dis from "../../dispatcher/dispatcher";
import { Action } from "../../dispatcher/actions";

// The room itself is not what this is about: a stand-in that says which room it is and whether it is on screen.
const roomMounts = vi.hoisted(() => ({ count: 0 }));
vi.mock("./RoomView", async () => {
    const { useEffect } = await import("react");
    return {
        RoomView: ({ active, keptRoomId }: { active?: boolean; keptRoomId?: string }) => {
            useEffect(() => {
                roomMounts.count++;
            }, []);
            return <div data-testid="room" data-active={String(active)} data-room={keptRoomId} />;
        },
    };
});

describe("<LoggedInView /> keeping rooms", () => {
    const mockClient = getMockClientWithEventEmitter({
        ...mockClientMethodsUser("@alice:domain.org"),
        ...mockClientMethodsServer(),
        ...mockClientMethodsRooms([]),
        getRoom: vi.fn((roomId: string) => ({ roomId, getMyMembership: () => KnownMembership.Join })),
        getAccountData: vi.fn(),
        getSyncState: vi.fn().mockReturnValue(null),
        getSyncStateData: vi.fn().mockReturnValue(null),
        getMediaHandler: vi.fn(),
        setPushRuleEnabled: vi.fn(),
        setPushRuleActions: vi.fn(),
        getCrypto: vi.fn().mockReturnValue(undefined),
        doesServerSupportExtendedProfiles: vi.fn().mockResolvedValue(true),
        setExtendedProfileProperty: vi.fn().mockResolvedValue(undefined),
        deleteExtendedProfileProperty: vi.fn().mockResolvedValue(undefined),
        matrixRTC: { on: vi.fn() },
        getAuthMetadata: vi.fn().mockRejectedValue(new Error("Legacy auth")),
        hasLazyLoadMembersEnabled: vi.fn(),
        isInitialSyncComplete: vi.fn(),
    });
    const sdk = new TestSDKContext();
    const props = {
        matrixClient: mockClient,
        onRegistered: vi.fn(),
        resizeNotifier: new ResizeNotifier(),
        hideToSRUsers: false,
        config: { brand: "Test" },
        currentUserId: "@alice:domain.org",
        page_type: "room_view",
    };
    const view = (currentRoomId: string): React.JSX.Element => (
        <SDKContext.Provider value={sdk}>
            <LoggedInView {...props} currentRoomId={currentRoomId} />
        </SDKContext.Provider>
    );

    beforeEach(() => {
        mockClient.getMediaHandler.mockReturnValue(new MediaHandler(mockClient));
        mockClient.setPushRuleActions.mockResolvedValue({});
        // @ts-expect-error
        mockClient.pushProcessor = new PushProcessor(mockClient);
        sdk._client = mockClient;
        const getValue = SettingsStore.getValue.bind(SettingsStore);
        settings = vi
            .spyOn(SettingsStore, "getValue")
            .mockImplementation(((name: string, ...rest: unknown[]) =>
                name === "feature_new_timeline" ? true : (getValue as any)(name, ...rest)) as any);
    });

    let settings: ReturnType<typeof vi.spyOn> | undefined;
    afterEach(() => {
        settings?.mockRestore();
        act(() => roomsAhead.clear());
        resetSwitchTimings();
        roomMounts.count = 0;
    });

    /*
     * That the rooms were all still there after a switch said nothing about whether they were the same
     * ones: with the chat columns on, every one of them was unmounted and built again on each switch.
     */
    it("builds a room once, however often it is switched away from and back to", () => {
        const { rerender } = render(view("!a:x"));
        rerender(view("!b:x"));
        const mountedBefore = roomMounts.count;
        rerender(view("!a:x"));
        rerender(view("!b:x"));
        expect(roomMounts.count).toBe(mountedBefore);
    });

    // Switching chats remounted the whole room every time; the ones shown before stay, behind it.
    it("keeps the rooms shown before mounted behind the one on screen", () => {
        const { rerender, getAllByTestId } = render(view("!a:x"));
        rerender(view("!b:x"));
        rerender(view("!c:x"));

        const rooms = getAllByTestId("room");
        expect(rooms).toHaveLength(3);
        expect(rooms.filter((room) => room.dataset.active === "true")).toHaveLength(1);

        // Back to the first: the same three, the first on screen again - nothing new mounted.
        rerender(view("!a:x"));
        expect(getAllByTestId("room")).toHaveLength(3);
    });

    it("keeps no more than five", () => {
        const { rerender, getAllByTestId } = render(view("!r0:x"));
        for (let i = 1; i < 8; i++) rerender(view(`!r${i}:x`));
        expect(getAllByTestId("room")).toHaveLength(5);
    });

    it("tells each room which room it is for, whatever the store says is on screen", () => {
        const { rerender, getAllByTestId } = render(view("!a:x"));
        rerender(view("!b:x"));
        expect(getAllByTestId("room").map((room) => room.dataset.room)).toEqual(["!b:x", "!a:x"]);
    });

    /*
     * A room opened for the first time was built after the click, which is the wait Telegram does not
     * have. One the reader is about to open is mounted behind the current one before they do.
     */
    it("mounts a room ahead of being opened, behind the one on screen", () => {
        const { getAllByTestId } = render(view("!a:x"));
        expect(getAllByTestId("room")).toHaveLength(1);

        act(() => roomsAhead.prepare("!next:x"));

        const rooms = getAllByTestId("room");
        expect(rooms.map((room) => [room.dataset.room, room.dataset.active])).toEqual([
            ["!a:x", "true"],
            ["!next:x", "false"],
        ]);
    });

    it("opens a room made ready without building it again", () => {
        const { rerender, getAllByTestId } = render(view("!a:x"));
        act(() => roomsAhead.prepare("!next:x"));
        const mountedBefore = roomMounts.count;

        rerender(view("!next:x"));

        // The same view brought to the front: nothing mounted for the click.
        expect(roomMounts.count).toBe(mountedBefore);
        const rooms = getAllByTestId("room");
        expect(rooms.find((room) => room.dataset.active === "true")?.dataset.room).toBe("!next:x");
        expect(rooms).toHaveLength(2);
        // It is a kept room now, so it no longer needs holding ahead - and a later guess does not evict it.
        expect(roomsAhead.list()).toEqual([]);
    });

    it("holds no room ahead that the reader is not in, and none twice", () => {
        mockClient.getRoom.mockImplementation(((roomId: string) =>
            roomId === "!left:x"
                ? { roomId, getMyMembership: () => KnownMembership.Leave }
                : { roomId, getMyMembership: () => KnownMembership.Join }) as any);
        const { getAllByTestId } = render(view("!a:x"));
        act(() => roomsAhead.prepare("!left:x"));
        // Already on screen: mounted once, as the room on screen.
        act(() => roomsAhead.prepare("!a:x"));
        expect(getAllByTestId("room").map((room) => room.dataset.room)).toEqual(["!a:x"]);
    });

    it("holds none ahead with the old timeline, which cannot sit behind another room", () => {
        settings?.mockRestore();
        const getValue = SettingsStore.getValue.bind(SettingsStore);
        settings = vi
            .spyOn(SettingsStore, "getValue")
            .mockImplementation(((name: string, ...rest: unknown[]) =>
                name === "feature_new_timeline" ? false : (getValue as any)(name, ...rest)) as any);
        const { queryAllByTestId } = render(view("!a:x"));
        act(() => roomsAhead.prepare("!next:x"));
        expect(queryAllByTestId("room").map((room) => room.dataset.room)).toEqual(["!a:x"]);
    });

    it("says how each room switched to was found", async () => {
        // What the view registers with the dispatcher, called as the dispatcher would: the real one would
        // hand the room to every store there is.
        const register = vi.spyOn(dis, "register");
        const { rerender } = render(view("!a:x"));
        const asked = (roomId: string): void =>
            register.mock.calls.forEach(([callback]) =>
                callback({ action: Action.ViewRoom, room_id: roomId, metricsTrigger: undefined }),
            );
        act(() => roomsAhead.prepare("!ahead:x"));
        const go = async (roomId: string): Promise<void> => {
            asked(roomId);
            rerender(view(roomId));
            // Two frames: the time is taken after the paint.
            await act(async () => {
                await new Promise((resolve) => setTimeout(resolve, 60));
            });
        };

        await go("!ahead:x");
        await go("!cold:x");
        await go("!a:x");

        expect(switchTimings().switches.map((one) => [one.roomId, one.kind])).toEqual([
            ["!ahead:x", "ahead"],
            ["!cold:x", "cold"],
            ["!a:x", "kept"],
        ]);
        expect(window.mxSwitchTimings().line).toMatch(/^mx_switch: kept \d+ ms \(1\) \| ahead \d+ ms \(1\) \| cold/);
    });
});
