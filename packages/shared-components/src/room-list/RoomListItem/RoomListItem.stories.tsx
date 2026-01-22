/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX } from "react";
import { fn } from "storybook/test";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { RoomListItemView, type RoomListItemSnapshot, type RoomListItemActions } from "./RoomListItem";
import { useMockedViewModel } from "../../useMockedViewModel";

type RoomListItemProps = RoomListItemSnapshot &
    RoomListItemActions & {
        isSelected: boolean;
        isFocused: boolean;
        onFocus: (room: any, e: React.FocusEvent) => void;
        roomIndex: number;
        roomCount: number;
        renderAvatar: (room: any) => React.ReactElement;
    };

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

const mockRoom = { name: "General" };

// Wrapper component that creates a mocked ViewModel
const RoomListItemWrapper = ({
    onOpenRoom,
    onMarkAsRead,
    onMarkAsUnread,
    onToggleFavorite,
    onToggleLowPriority,
    onInvite,
    onCopyRoomLink,
    onLeaveRoom,
    onSetRoomNotifState,
    isSelected,
    isFocused,
    onFocus,
    roomIndex,
    roomCount,
    renderAvatar: renderAvatarProp,
    ...rest
}: RoomListItemProps): JSX.Element => {
    const vm = useMockedViewModel(rest, {
        onOpenRoom,
        onMarkAsRead,
        onMarkAsUnread,
        onToggleFavorite,
        onToggleLowPriority,
        onInvite,
        onCopyRoomLink,
        onLeaveRoom,
        onSetRoomNotifState,
    });
    return (
        <RoomListItemView
            vm={vm}
            isSelected={isSelected}
            isFocused={isFocused}
            onFocus={onFocus}
            roomIndex={roomIndex}
            roomCount={roomCount}
            renderAvatar={renderAvatarProp}
        />
    );
};

const meta = {
    title: "Room List/RoomListItem",
    component: RoomListItemWrapper,
    tags: ["autodocs"],
    decorators: [
        (Story) => (
            <div style={{ width: "320px", padding: "8px" }}>
                <div role="listbox" aria-label="Room list">
                    <Story />
                </div>
            </div>
        ),
    ],
    args: {
        // Snapshot properties (state)
        id: "!room:server",
        room: mockRoom,
        name: "General",
        a11yLabel: "Open room General",
        isBold: false,
        messagePreview: "Alice: Hey everyone!",
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
        isSelected: false,
        isFocused: false,
        roomIndex: 0,
        roomCount: 10,
        // Action properties (callbacks)
        onOpenRoom: fn(),
        onMarkAsRead: fn(),
        onMarkAsUnread: fn(),
        onToggleFavorite: fn(),
        onToggleLowPriority: fn(),
        onInvite: fn(),
        onCopyRoomLink: fn(),
        onLeaveRoom: fn(),
        onSetRoomNotifState: fn(),
        onFocus: fn(),
        renderAvatar,
    },
} satisfies Meta<typeof RoomListItemWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Selected: Story = {
    args: {
        isSelected: true,
    },
};

export const Bold: Story = {
    args: {
        isBold: true,
        name: "Team Updates",
    },
};

export const WithNotification: Story = {
    args: {
        isBold: true,
        notification: {
            hasAnyNotificationOrActivity: true,
            isUnsentMessage: false,
            invited: false,
            isMention: false,
            isActivityNotification: false,
            isNotification: true,
            hasUnreadCount: true,
            count: 3,
            muted: false,
        },
    },
};

export const WithMention: Story = {
    args: {
        isBold: true,
        notification: {
            hasAnyNotificationOrActivity: true,
            isUnsentMessage: false,
            invited: false,
            isMention: true,
            isActivityNotification: false,
            isNotification: true,
            hasUnreadCount: true,
            count: 1,
            muted: false,
        },
    },
};

export const Invitation: Story = {
    args: {
        name: "Secret Project",
        messagePreview: "Bob invited you",
        notification: {
            hasAnyNotificationOrActivity: true,
            isUnsentMessage: false,
            invited: true,
            isMention: false,
            isActivityNotification: false,
            isNotification: true,
            hasUnreadCount: false,
            count: 1,
            muted: false,
        },
    },
};

export const UnsentMessage: Story = {
    args: {
        messagePreview: "Failed to send message",
        notification: {
            hasAnyNotificationOrActivity: true,
            isUnsentMessage: true,
            invited: false,
            isMention: false,
            isActivityNotification: false,
            isNotification: false,
            hasUnreadCount: false,
            count: 0,
            muted: false,
        },
    },
};

export const NoMessagePreview: Story = {
    args: {
        messagePreview: undefined,
    },
};

export const Favourited: Story = {
    args: {
        moreOptionsState: {
            isFavourite: true,
            isLowPriority: false,
            canInvite: true,
            canCopyRoomLink: true,
            canMarkAsRead: false,
            canMarkAsUnread: true,
        },
    },
};

export const LowPriority: Story = {
    args: {
        moreOptionsState: {
            isFavourite: false,
            isLowPriority: true,
            canInvite: true,
            canCopyRoomLink: true,
            canMarkAsRead: false,
            canMarkAsUnread: true,
        },
    },
};
