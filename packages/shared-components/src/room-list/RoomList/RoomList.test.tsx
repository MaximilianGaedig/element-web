/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { VirtuosoMockContext } from "react-virtuoso";
import "@testing-library/jest-dom";

import { RoomList } from "./RoomList";
import type { RoomListViewModel, RoomListSnapshot } from "../RoomListView";
import { MockViewModel } from "../../viewmodel";

describe("<RoomList />", () => {
    const getRoomItemViewModel = jest.fn();
    const updateVisibleRooms = jest.fn();
    const onToggleFilter = jest.fn();
    const createChatRoom = jest.fn();
    const createRoom = jest.fn();

    class RoomListTestViewModel extends MockViewModel<RoomListSnapshot> implements RoomListViewModel {
        public getRoomItemViewModel = getRoomItemViewModel;
        public updateVisibleRooms = updateVisibleRooms;
        public onToggleFilter = onToggleFilter;
        public createChatRoom = createChatRoom;
        public createRoom = createRoom;
    }

    let mockSnapshot: RoomListSnapshot;
    let mockViewModel: RoomListViewModel;
    const mockRenderAvatar = jest.fn((room: any) => <div data-testid="avatar">{room.name}</div>);

    const roomSnapshots = new Map<string, any>();
    const getRoomSnapshot = (roomId: string): any => {
        if (!roomSnapshots.has(roomId)) {
            roomSnapshots.set(roomId, {
                id: roomId,
                room: { roomId, name: `Room ${roomId}` } as any,
                name: `Room ${roomId}`,
                a11yLabel: `Open room ${roomId}`,
                isBold: false,
                messagePreview: undefined,
                notification: {
                    hasAnyNotificationOrActivity: false,
                    isUnsentMessage: false,
                    invited: false,
                    isMention: false,
                    isActivityNotification: false,
                    isNotification: false,
                    hasUnreadCount: false,
                    count: 0,
                    muted: false,
                },
                showMoreOptionsMenu: false,
                showNotificationMenu: false,
                moreOptionsState: {} as any,
                notificationState: {} as any,
            });
        }
        return roomSnapshots.get(roomId);
    };

    // Set up the mock implementation once at module scope
    getRoomItemViewModel.mockImplementation((roomId: string) => ({
        subscribe: jest.fn(),
        getSnapshot: () => getRoomSnapshot(roomId),
        getRoom: () => ({ roomId, name: `Room ${roomId}` }),
        onOpenRoom: jest.fn(),
        onMarkAsRead: jest.fn(),
        onMarkAsUnread: jest.fn(),
        onToggleFavorite: jest.fn(),
        onToggleLowPriority: jest.fn(),
        onInvite: jest.fn(),
        onCopyRoomLink: jest.fn(),
        onLeaveRoom: jest.fn(),
        onSetRoomNotifState: jest.fn(),
    }));

    const renderWithMockContext = (component: React.ReactElement): ReturnType<typeof render> => {
        return render(component, {
            wrapper: ({ children }) => (
                <VirtuosoMockContext.Provider value={{ viewportHeight: 600, itemHeight: 48 }}>
                    {children}
                </VirtuosoMockContext.Provider>
            ),
        });
    };

    beforeEach(() => {
        // Clear call history but keep mock implementations
        getRoomItemViewModel.mockClear();
        updateVisibleRooms.mockClear();
        mockRenderAvatar.mockClear();
        roomSnapshots.clear();

        mockSnapshot = {
            isLoadingRooms: false,
            isRoomListEmpty: false,
            filters: [],
            roomIds: ["room1", "room2", "room3"],
            roomListState: {
                activeRoomIndex: 0,
                spaceId: "space1",
                filterKeys: undefined,
            },
        };

        mockViewModel = new RoomListTestViewModel(mockSnapshot);
    });

    it("should render the room list", () => {
        renderWithMockContext(<RoomList vm={mockViewModel} renderAvatar={mockRenderAvatar} />);

        expect(screen.getByRole("listbox", { name: "Room list" })).toBeInTheDocument();
    });

    it("should render room items", () => {
        renderWithMockContext(<RoomList vm={mockViewModel} renderAvatar={mockRenderAvatar} />);

        // All rooms should be rendered as options in the listbox
        const items = screen.getAllByRole("option");
        expect(items).toHaveLength(3);
        expect(items[0]).toHaveAccessibleName("Open room Room room1");
        expect(items[1]).toHaveAccessibleName("Open room Room room2");
        expect(items[2]).toHaveAccessibleName("Open room Room room3");
    });

    it("should call renderAvatar for each room", () => {
        renderWithMockContext(<RoomList vm={mockViewModel} renderAvatar={mockRenderAvatar} />);

        // renderAvatar should be called for each visible room
        expect(mockRenderAvatar).toHaveBeenCalled();
        expect(screen.getAllByTestId("avatar")).toHaveLength(3);
    });

    it("should call getRoomItemViewModel for each room", () => {
        renderWithMockContext(<RoomList vm={mockViewModel} renderAvatar={mockRenderAvatar} />);

        expect(getRoomItemViewModel).toHaveBeenCalledWith("room1");
        expect(getRoomItemViewModel).toHaveBeenCalledWith("room2");
        expect(getRoomItemViewModel).toHaveBeenCalledWith("room3");
    });

    it("should mark the active room as selected", () => {
        const { rerender } = renderWithMockContext(<RoomList vm={mockViewModel} renderAvatar={mockRenderAvatar} />);

        // Update to mark second room as active
        mockSnapshot.roomListState.activeRoomIndex = 1;
        mockViewModel = new RoomListTestViewModel(mockSnapshot);
        rerender(<RoomList vm={mockViewModel} renderAvatar={mockRenderAvatar} />);

        const items = screen.getAllByRole("option");
        expect(items[0]).toHaveAttribute("aria-selected", "false");
        expect(items[1]).toHaveAttribute("aria-selected", "true");
        expect(items[2]).toHaveAttribute("aria-selected", "false");
    });

    it("should handle empty room list", () => {
        mockSnapshot.roomIds = [];
        mockViewModel = new RoomListTestViewModel(mockSnapshot);
        renderWithMockContext(<RoomList vm={mockViewModel} renderAvatar={mockRenderAvatar} />);

        expect(screen.getByRole("listbox", { name: "Room list" })).toBeInTheDocument();
        expect(screen.queryByRole("option")).toBeNull();
    });

    it("should call updateVisibleRooms when range changes", () => {
        renderWithMockContext(<RoomList vm={mockViewModel} renderAvatar={mockRenderAvatar} />);

        // The virtuoso component should trigger rangeChanged callback
        // This would be called internally by Virtuoso when scrolling
        expect(updateVisibleRooms).toHaveBeenCalled();
    });

    it("should handle focus state correctly", () => {
        mockSnapshot.roomListState.activeRoomIndex = 0;
        mockViewModel = new RoomListTestViewModel(mockSnapshot);
        renderWithMockContext(<RoomList vm={mockViewModel} renderAvatar={mockRenderAvatar} />);

        // Focus the listbox container to activate focus management
        const listbox = screen.getByRole("listbox", { name: "Room list" });
        fireEvent.focus(listbox);

        const items = screen.getAllByRole("option");
        // First item should have tabIndex 0 (focusable)
        expect(items[0]).toHaveAttribute("tabIndex", "0");
        // Other items should have tabIndex -1
        expect(items[1]).toHaveAttribute("tabIndex", "-1");
        expect(items[2]).toHaveAttribute("tabIndex", "-1");
    });

    it("should update when roomIds change", () => {
        const { rerender } = renderWithMockContext(<RoomList vm={mockViewModel} renderAvatar={mockRenderAvatar} />);

        expect(screen.getAllByRole("option")).toHaveLength(3);

        // Update roomIds
        mockSnapshot.roomIds = ["room1", "room2"];
        mockViewModel = new RoomListTestViewModel(mockSnapshot);
        rerender(<RoomList vm={mockViewModel} renderAvatar={mockRenderAvatar} />);

        expect(screen.getAllByRole("option")).toHaveLength(2);
    });

    it("should update when activeRoomIndex changes", () => {
        mockSnapshot.roomListState.activeRoomIndex = 0;
        mockViewModel = new RoomListTestViewModel(mockSnapshot);
        const { rerender } = renderWithMockContext(<RoomList vm={mockViewModel} renderAvatar={mockRenderAvatar} />);

        let items = screen.getAllByRole("option");
        expect(items[0]).toHaveAttribute("aria-selected", "true");
        expect(items[1]).toHaveAttribute("aria-selected", "false");

        // Change active room
        mockSnapshot.roomListState.activeRoomIndex = 1;
        mockViewModel = new RoomListTestViewModel(mockSnapshot);
        rerender(<RoomList vm={mockViewModel} renderAvatar={mockRenderAvatar} />);

        items = screen.getAllByRole("option");
        expect(items[0]).toHaveAttribute("aria-selected", "false");
        expect(items[1]).toHaveAttribute("aria-selected", "true");
    });

    it("should handle space changes", () => {
        const { rerender } = renderWithMockContext(<RoomList vm={mockViewModel} renderAvatar={mockRenderAvatar} />);

        // Change space
        mockSnapshot.roomListState.spaceId = "space2";
        mockViewModel = new RoomListTestViewModel(mockSnapshot);
        rerender(<RoomList vm={mockViewModel} renderAvatar={mockRenderAvatar} />);

        // Should still render the room list
        expect(screen.getByRole("listbox", { name: "Room list" })).toBeInTheDocument();
    });

    it("should handle filter changes", () => {
        const { rerender } = renderWithMockContext(<RoomList vm={mockViewModel} renderAvatar={mockRenderAvatar} />);

        expect(screen.getAllByRole("option")).toHaveLength(3);

        // Apply filter
        mockSnapshot.roomListState.filterKeys = ["unread"];
        mockSnapshot.roomIds = ["room1"]; // Filtered list
        mockViewModel = new RoomListTestViewModel(mockSnapshot);
        rerender(<RoomList vm={mockViewModel} renderAvatar={mockRenderAvatar} />);

        expect(screen.getAllByRole("option")).toHaveLength(1);
    });
});
