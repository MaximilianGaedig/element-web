/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Filter } from "../RoomListPrimaryFilters";
import { RoomListView, type RoomListViewModel, type RoomListSnapshot } from "./RoomListView";

// Mock avatar component
const mockAvatar = (name: string): React.ReactElement => (
    <div
        style={{
            width: "32px",
            height: "32px",
            borderRadius: "50%",
            backgroundColor: "#0dbd8b",
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

const mockFilters: Filter[] = [
    { id: "unread", active: false },
    { id: "people", active: false },
    { id: "rooms", active: false },
    { id: "favourite", active: false },
];

// Create stable unsubscribe function
const noop = (): void => {};

function createMockViewModel(snapshot: RoomListSnapshot): RoomListViewModel {
    return {
        getSnapshot: () => snapshot,
        subscribe: () => noop,
        createChatRoom: () => console.log("Create chat room"),
        createRoom: () => console.log("Create room"),
        onToggleFilter: (filter) => console.log("Toggle filter:", filter),
        getRoomItemViewModel: () => {
            throw new Error("getRoomItemViewModel not implemented in stories");
        },
        updateVisibleRooms: (startIndex: number, endIndex: number) =>
            console.log("Update visible rooms:", startIndex, endIndex),
    };
}

const renderAvatar = (room: any): React.ReactElement => {
    return mockAvatar(room?.name || "Room");
};

const meta = {
    title: "Room List/RoomListView",
    component: RoomListView,
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
        renderAvatar,
    },
} satisfies Meta<typeof RoomListView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
    args: {
        vm: createMockViewModel({
            isLoadingRooms: false,
            isRoomListEmpty: false,
            filters: mockFilters,
            roomListState: {
                activeRoomIndex: undefined,
                spaceId: "!space:server",
                filterKeys: undefined,
            },
            roomIds: [],
            canCreateRoom: true,
        }),
    },
};

export const Loading: Story = {
    args: {
        vm: createMockViewModel({
            isLoadingRooms: true,
            isRoomListEmpty: false,
            filters: mockFilters,
            roomListState: {
                activeRoomIndex: undefined,
                spaceId: "!space:server",
                filterKeys: undefined,
            },
            roomIds: [],
            canCreateRoom: true,
        }),
    },
};

export const Empty: Story = {
    args: {
        vm: createMockViewModel({
            isLoadingRooms: false,
            isRoomListEmpty: true,
            filters: mockFilters,
            roomListState: {
                activeRoomIndex: undefined,
                spaceId: "!space:server",
                filterKeys: undefined,
            },
            roomIds: [],
            canCreateRoom: true,
        }),
    },
};

export const EmptyWithoutCreatePermission: Story = {
    args: {
        vm: createMockViewModel({
            isLoadingRooms: false,
            isRoomListEmpty: true,
            filters: mockFilters,
            roomListState: {
                activeRoomIndex: undefined,
                spaceId: "!space:server",
                filterKeys: undefined,
            },
            roomIds: [],
            canCreateRoom: false,
        }),
    },
};

export const WithActiveFilter: Story = {
    args: {
        vm: createMockViewModel({
            isLoadingRooms: false,
            isRoomListEmpty: false,
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
            roomIds: [],
            canCreateRoom: true,
        }),
    },
};

export const WithSelection: Story = {
    args: {
        vm: createMockViewModel({
            isLoadingRooms: false,
            isRoomListEmpty: false,
            filters: mockFilters,
            roomListState: {
                activeRoomIndex: 10,
                spaceId: "!space:server",
                filterKeys: undefined,
            },
            roomIds: [],
            canCreateRoom: true,
        }),
    },
};

export const SmallList: Story = {
    args: {
        vm: createMockViewModel({
            isLoadingRooms: false,
            isRoomListEmpty: false,
            filters: mockFilters,
            roomListState: {
                activeRoomIndex: undefined,
                spaceId: "!space:server",
                filterKeys: undefined,
            },
            roomIds: [],
            canCreateRoom: true,
        }),
    },
};

export const LargeList: Story = {
    args: {
        vm: createMockViewModel({
            isLoadingRooms: false,
            isRoomListEmpty: false,
            filters: mockFilters,
            roomListState: {
                activeRoomIndex: undefined,
                spaceId: "!space:server",
                filterKeys: undefined,
            },
            roomIds: [],
            canCreateRoom: true,
        }),
    },
};
