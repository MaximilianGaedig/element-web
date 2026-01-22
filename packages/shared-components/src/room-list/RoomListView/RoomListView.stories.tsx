/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX } from "react";
import { fn } from "storybook/test";

import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Filter } from "../RoomListPrimaryFilters";
import { RoomListView, type RoomListSnapshot, type RoomListViewActions } from "./RoomListView";
import { useMockedViewModel } from "../../useMockedViewModel";
import type { RoomListItemSnapshot } from "../RoomListItem";

type RoomListViewProps = RoomListSnapshot & RoomListViewActions & { renderAvatar: (room: any) => React.ReactElement };

// Mock avatar component
const mockAvatar = (name: string): React.ReactElement => (
    <div
        role="img"
        aria-label={`${name} avatar`}
        style={{
            width: "32px",
            height: "32px",
            borderRadius: "50%",
            backgroundColor: "#0B7F67",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "white",
            fontWeight: "bold",
            fontSize: "12px",
        }}
    >
        {name.substring(0, 2).toUpperCase()}
    </div>
);

const renderAvatar = (room: any): React.ReactElement => {
    return mockAvatar(room?.name || "Room");
};

const mockFilters: Filter[] = [
    { id: "unread", active: false },
    { id: "people", active: false },
    { id: "rooms", active: false },
    { id: "favourite", active: false },
];

// Create mock room item snapshots
const createMockRoomSnapshot = (id: string, name: string, index: number): RoomListItemSnapshot => ({
    id,
    room: { name },
    name,
    a11yLabel: `Open room ${name}`,
    isBold: index % 3 === 0, // Every third room is bold
    messagePreview: index % 2 === 0 ? `Last message in ${name}` : undefined,
    notification: {
        hasAnyNotificationOrActivity: index % 5 === 0,
        isUnsentMessage: false,
        invited: false,
        isMention: index % 5 === 0,
        isActivityNotification: false,
        isNotification: index % 5 === 0,
        hasUnreadCount: index % 5 === 0,
        count: index % 5 === 0 ? index : 0,
        muted: false,
    },
    showMoreOptionsMenu: false,
    showNotificationMenu: false,
    moreOptionsState: {
        isFavourite: false,
        isLowPriority: false,
        canInvite: true,
        canCopyRoomLink: true,
        canMarkAsRead: false,
        canMarkAsUnread: true,
    },
    notificationState: {
        isNotificationAllMessage: true,
        isNotificationAllMessageLoud: false,
        isNotificationMentionOnly: false,
        isNotificationMute: false,
    },
});

// Mock room IDs for different list sizes
const mockRoomIds = Array.from({ length: 20 }, (_, i) => `!room${i}:server`);
const smallListRoomIds = mockRoomIds.slice(0, 5);
const largeListRoomIds = Array.from({ length: 100 }, (_, i) => `!room${i}:server`);

// Mock getRoomItemViewModel that returns view model instances
const createGetRoomItemViewModel = (roomIds: string[]) => {
    const roomNames = [
        "General",
        "Random",
        "Engineering",
        "Design",
        "Product",
        "Marketing",
        "Sales",
        "Support",
        "Announcements",
        "Off-topic",
        "Team Alpha",
        "Team Beta",
        "Project X",
        "Project Y",
        "Water Cooler",
        "Feedback",
        "Ideas",
        "Bugs",
        "Features",
        "Releases",
    ];

    // Create a map of room IDs to view model instances
    const viewModels = new Map();
    roomIds.forEach((roomId, index) => {
        const name = roomNames[index % roomNames.length];
        const snapshot = createMockRoomSnapshot(roomId, name, index);
        
        // Create a simple mock view model that implements the ViewModel interface
        const mockViewModel = {
            getSnapshot: () => snapshot,
            subscribe: fn(),
            unsubscribe: fn(),
            onOpenRoom: fn(),
            onMarkAsRead: fn(),
            onMarkAsUnread: fn(),
            onToggleFavorite: fn(),
            onToggleLowPriority: fn(),
            onInvite: fn(),
            onCopyRoomLink: fn(),
            onLeaveRoom: fn(),
            onSetRoomNotifState: fn(),
        };
        viewModels.set(roomId, mockViewModel);
    });

    return (roomId: string) => viewModels.get(roomId);
};

// Wrapper component that creates a mocked ViewModel
const RoomListViewWrapper = ({
    onToggleFilter,
    createChatRoom,
    createRoom,
    getRoomItemViewModel,
    updateVisibleRooms,
    renderAvatar: renderAvatarProp,
    ...rest
}: RoomListViewProps): JSX.Element => {
    const vm = useMockedViewModel(rest, {
        onToggleFilter,
        createChatRoom,
        createRoom,
        getRoomItemViewModel,
        updateVisibleRooms,
    });
    return <RoomListView vm={vm} renderAvatar={renderAvatarProp} />;
};

const meta = {
    title: "Room List/RoomListView",
    component: RoomListViewWrapper,
    tags: ["autodocs"],
    decorators: [
        (Story) => (
            <div
                style={{
                    width: "320px",
                    height: "600px",
                    border: "1px solid var(--cpd-color-border-interactive-primary)",
                    display: "flex",
                    flexDirection: "column",
                    resize: "horizontal",
                    overflow: "auto",
                    minWidth: "250px",
                    maxWidth: "800px",
                }}
            >
                <Story />
            </div>
        ),
    ],
    args: {
        // Snapshot properties (state)
        isLoadingRooms: false,
        isRoomListEmpty: false,
        filters: mockFilters,
        roomListState: {
            activeRoomIndex: undefined,
            spaceId: "!space:server",
            filterKeys: undefined,
        },
        roomIds: mockRoomIds,
        canCreateRoom: true,
        // Action properties (callbacks)
        onToggleFilter: fn(),
        createChatRoom: fn(),
        createRoom: fn(),
        getRoomItemViewModel: createGetRoomItemViewModel(mockRoomIds),
        updateVisibleRooms: fn(),
        renderAvatar,
    },
    parameters: {
        design: {
            type: "figma",
            url: "https://www.figma.com/design/vlmt46QDdE4dgXDiyBJXqp/ER-33-Left-Panel?node-id=2925-19126",
        },
    },
} satisfies Meta<typeof RoomListViewWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Loading: Story = {
    args: {
        isLoadingRooms: true,
    },
};

export const Empty: Story = {
    args: {
        isRoomListEmpty: true,
    },
};

export const EmptyWithoutCreatePermission: Story = {
    args: {
        isRoomListEmpty: true,
        canCreateRoom: false,
    },
};

export const WithActiveFilter: Story = {
    args: {
        filters: [
            { id: "unread", active: false },
            { id: "people", active: false },
            { id: "rooms", active: false },
            { id: "favourite", active: true },
        ],
        roomListState: {
            activeRoomIndex: undefined,
            spaceId: "!space:server",
            filterKeys: ["favourites"],
        },
    },
};

// Note: This story demonstrates selection state but the snapshot may not show rooms
// due to a timing issue with the virtualized list's initialTopMostItemIndex.
// The story works correctly when viewed in Storybook.
export const WithSelection: Story = {
    args: {
        roomListState: {
            activeRoomIndex: 3,
            spaceId: "!space:server",
            filterKeys: undefined,
        },
    },
    parameters: {
        // Skip visual regression test for this story due to virtualization timing
        storyshots: { disable: true },
    },
};

export const SmallList: Story = {
    args: {
        roomIds: smallListRoomIds,
        getRoomItemViewModel: createGetRoomItemViewModel(smallListRoomIds),
    },
};

export const LargeList: Story = {
    args: {
        roomIds: largeListRoomIds,
        getRoomItemViewModel: createGetRoomItemViewModel(largeListRoomIds),
    },
};
