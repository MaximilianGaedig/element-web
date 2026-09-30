/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import React from "react";
import { render } from "test-utils-rtl";
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

// The room itself is not what this is about: a stand-in that says which room it is and whether it is on screen.
vi.mock("./RoomView", () => ({
    RoomView: ({ active }: { active?: boolean }) => <div data-testid="room" data-active={String(active)} />,
}));

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
});
