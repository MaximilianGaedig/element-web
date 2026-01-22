/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VirtuosoMockContext } from "react-virtuoso";
import "@testing-library/jest-dom";

import { RoomListView } from "./RoomListView";
import type { RoomListViewModel, RoomListSnapshot } from "./RoomListView";
import { MockViewModel } from "../../viewmodel";

describe("<RoomListView />", () => {
    const getRoomItemViewModel = jest.fn();
    const updateVisibleRooms = jest.fn();
    const onToggleFilter = jest.fn();
    const createChatRoom = jest.fn();
    const createRoom = jest.fn();

    class RoomListViewTestViewModel extends MockViewModel<RoomListSnapshot> implements RoomListViewModel {
        public getRoomItemViewModel = getRoomItemViewModel;
        public updateVisibleRooms = updateVisibleRooms;
        public onToggleFilter = onToggleFilter;
        public createChatRoom = createChatRoom;
        public createRoom = createRoom;
    }

    let mockSnapshot: RoomListSnapshot;
    let mockViewModel: RoomListViewModel;
    const mockRenderAvatar = jest.fn((room: any) => <div data-testid="avatar">Avatar</div>);

    // Mock ResizeObserver which is used by RoomListPrimaryFilters
    beforeAll(() => {
        global.ResizeObserver = jest.fn().mockImplementation(() => ({
            observe: jest.fn(),
            unobserve: jest.fn(),
            disconnect: jest.fn(),
        }));
    });

    // Cache snapshots for room item ViewModels to satisfy React's useSyncExternalStore requirement
    const roomSnapshots = new Map<string, any>();

    getRoomItemViewModel.mockImplementation((roomId: string) => ({
        subscribe: jest.fn(),
        getSnapshot: () => {
            if (!roomSnapshots.has(roomId)) {
                roomSnapshots.set(roomId, {
                    id: roomId,
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
        },
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
        getRoomItemViewModel.mockClear();
        updateVisibleRooms.mockClear();
        onToggleFilter.mockClear();
        createChatRoom.mockClear();
        createRoom.mockClear();
        mockRenderAvatar.mockClear();
        roomSnapshots.clear();

        mockSnapshot = {
            isLoadingRooms: false,
            isRoomListEmpty: false,
            filters: [
                { id: "people", active: false },
                { id: "rooms", active: false },
                { id: "unread", active: false },
            ],
            roomIds: ["room1", "room2", "room3"],
            roomListState: {
                activeRoomIndex: 0,
                spaceId: "space1",
                filterKeys: undefined,
            },
        };

        mockViewModel = new RoomListViewTestViewModel(mockSnapshot);
    });

    it("should render the room list view", () => {
        renderWithMockContext(<RoomListView vm={mockViewModel} renderAvatar={mockRenderAvatar} />);

        expect(screen.getByRole("listbox", { name: "Room list" })).toBeInTheDocument();
    });

    it("should render primary filters", () => {
        renderWithMockContext(<RoomListView vm={mockViewModel} renderAvatar={mockRenderAvatar} />);

        expect(screen.getByRole("listbox", { name: "Room list filters" })).toBeInTheDocument();
        // Only the first filter is visible by default (filters collapse)
        expect(screen.getByRole("option", { name: "People" })).toBeInTheDocument();
    });

    it("should call onToggleFilter when filter is clicked", async () => {
        const user = userEvent.setup();
        renderWithMockContext(<RoomListView vm={mockViewModel} renderAvatar={mockRenderAvatar} />);

        await user.click(screen.getByRole("option", { name: "People" }));

        expect(onToggleFilter).toHaveBeenCalledWith(mockSnapshot.filters[0]);
    });

    it("should render room items", () => {
        renderWithMockContext(<RoomListView vm={mockViewModel} renderAvatar={mockRenderAvatar} />);

        expect(screen.getByText("Room room1")).toBeInTheDocument();
        expect(screen.getByText("Room room2")).toBeInTheDocument();
        expect(screen.getByText("Room room3")).toBeInTheDocument();
    });

    it("should show loading skeleton when isLoadingRooms is true", () => {
        mockSnapshot.isLoadingRooms = true;
        mockViewModel = new RoomListViewTestViewModel(mockSnapshot);
        const { container } = renderWithMockContext(
            <RoomListView vm={mockViewModel} renderAvatar={mockRenderAvatar} />,
        );

        // Check for skeleton class since there's no test ID
        expect(container.querySelector(".skeleton")).toBeInTheDocument();
    });

    it("should show empty state when room list is empty", () => {
        mockSnapshot.isRoomListEmpty = true;
        mockSnapshot.roomIds = [];
        mockViewModel = new RoomListViewTestViewModel(mockSnapshot);
        renderWithMockContext(<RoomListView vm={mockViewModel} renderAvatar={mockRenderAvatar} />);

        expect(screen.getByText("No chats yet")).toBeInTheDocument();
    });

    it("should show create room button in empty state when canCreateRoom is true", () => {
        mockSnapshot.isRoomListEmpty = true;
        mockSnapshot.roomIds = [];
        mockSnapshot.canCreateRoom = true;
        mockViewModel = new RoomListViewTestViewModel(mockSnapshot);
        renderWithMockContext(<RoomListView vm={mockViewModel} renderAvatar={mockRenderAvatar} />);

        expect(screen.getByRole("button", { name: "New room" })).toBeInTheDocument();
    });

    it("should not show create room button in empty state when canCreateRoom is false", () => {
        mockSnapshot.isRoomListEmpty = true;
        mockSnapshot.roomIds = [];
        mockSnapshot.canCreateRoom = false;
        mockViewModel = new RoomListViewTestViewModel(mockSnapshot);
        renderWithMockContext(<RoomListView vm={mockViewModel} renderAvatar={mockRenderAvatar} />);

        expect(screen.queryByRole("button", { name: "New room" })).toBeNull();
    });

    it("should call createRoom when New room button is clicked", async () => {
        const user = userEvent.setup();
        mockSnapshot.isRoomListEmpty = true;
        mockSnapshot.roomIds = [];
        mockSnapshot.canCreateRoom = true;
        mockViewModel = new RoomListViewTestViewModel(mockSnapshot);
        renderWithMockContext(<RoomListView vm={mockViewModel} renderAvatar={mockRenderAvatar} />);

        await user.click(screen.getByRole("button", { name: "New room" }));

        expect(createRoom).toHaveBeenCalled();
    });

    it("should call createChatRoom when Start chat button is clicked", async () => {
        const user = userEvent.setup();
        mockSnapshot.isRoomListEmpty = true;
        mockSnapshot.roomIds = [];
        mockViewModel = new RoomListViewTestViewModel(mockSnapshot);
        renderWithMockContext(<RoomListView vm={mockViewModel} renderAvatar={mockRenderAvatar} />);

        await user.click(screen.getByRole("button", { name: "Start chat" }));

        expect(createChatRoom).toHaveBeenCalled();
    });

    it("should show filtered empty state with correct message", () => {
        mockSnapshot.isRoomListEmpty = true;
        mockSnapshot.roomIds = [];
        mockSnapshot.filters = [
            { id: "people", active: true },
            { id: "rooms", active: false },
            { id: "unread", active: false },
        ];
        mockViewModel = new RoomListViewTestViewModel(mockSnapshot);
        renderWithMockContext(<RoomListView vm={mockViewModel} renderAvatar={mockRenderAvatar} />);

        // Check for the empty state using the test ID
        const emptyState = screen.getByTestId("empty-room-list");
        expect(emptyState).toBeInTheDocument();
        expect(emptyState.textContent).toContain("You don't have direct chats with anyone yet");
    });

    it("should handle multiple active filters", () => {
        mockSnapshot.filters = [
            { id: "people", active: true },
            { id: "unread", active: true },
            { id: "rooms", active: false },
        ];
        mockViewModel = new RoomListViewTestViewModel(mockSnapshot);
        renderWithMockContext(<RoomListView vm={mockViewModel} renderAvatar={mockRenderAvatar} />);

        // At least the first filter should be visible
        const peopleFilter = screen.getByRole("option", { name: "People" });
        expect(peopleFilter).toHaveAttribute("aria-selected", "true");
    });

    it("should not render filters or empty state when loading", () => {
        mockSnapshot.isLoadingRooms = true;
        mockSnapshot.isRoomListEmpty = true;
        mockViewModel = new RoomListViewTestViewModel(mockSnapshot);
        const { container } = renderWithMockContext(
            <RoomListView vm={mockViewModel} renderAvatar={mockRenderAvatar} />,
        );

        // Should show loading skeleton, not empty state
        expect(container.querySelector(".skeleton")).toBeInTheDocument();
        expect(screen.queryByText("No chats yet")).toBeNull();
    });
});
