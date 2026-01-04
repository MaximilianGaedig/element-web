/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX, memo, useEffect, useRef, type ReactNode } from "react";
import classNames from "classnames";

import { Flex } from "../../utils/Flex";
import { NotificationDecoration, type NotificationDecorationData } from "./NotificationDecoration";
import { RoomListItemHoverMenu, type MoreOptionsMenuState, type NotificationMenuState } from "./RoomListItemHoverMenu";
import { RoomListItemContextMenu } from "./RoomListItemContextMenu";
import { type RoomNotifState } from "./RoomNotifs";
import styles from "./RoomListItem.module.css";
import { useViewModel } from "../../useViewModel";
import { type ViewModel } from "../../viewmodel/ViewModel";

/**
 * Snapshot for a room list item.
 * Contains all the data needed to render a room in the list.
 */
export interface RoomListItemSnapshot {
    /** Unique identifier for the room (used for list keying) */
    id: string;
    /** The name of the room */
    name: string;
    /** Accessibility label for the room list item */
    a11yLabel: string;
    /** Whether the room name should be bolded (has unread/activity) */
    isBold: boolean;
    /** Optional message preview text */
    messagePreview?: string;
    /** Notification decoration data */
    notification: NotificationDecorationData;
    /** Whether the more options menu should be shown */
    showMoreOptionsMenu: boolean;
    /** Whether the notification menu should be shown */
    showNotificationMenu: boolean;
    /** More options menu state */
    moreOptionsState: MoreOptionsMenuState;
    /** Notification menu state */
    notificationState: NotificationMenuState;
}

/**
 * Actions interface for room list item operations.
 * Implemented by the room item view model.
 */
export interface RoomListItemActions {
    /** Called when the room should be opened */
    onOpenRoom: () => void;
    /** Called when the room should be marked as read */
    onMarkAsRead: () => void;
    /** Called when the room should be marked as unread */
    onMarkAsUnread: () => void;
    /** Called when the room's favorite status should be toggled */
    onToggleFavorite: () => void;
    /** Called when the room's low priority status should be toggled */
    onToggleLowPriority: () => void;
    /** Called when inviting users to the room */
    onInvite: () => void;
    /** Called when copying the room link */
    onCopyRoomLink: () => void;
    /** Called when leaving the room */
    onLeaveRoom: () => void;
    /** Called when setting the room notification state */
    onSetRoomNotifState: (state: RoomNotifState) => void;
    /** Get the opaque Room object for this item */
    getRoom: () => any;
}

/**
 * The view model type for a room list item
 */
export type RoomItemViewModel = ViewModel<RoomListItemSnapshot> & RoomListItemActions;

/**
 * Props for RoomListItemView component
 */
export interface RoomListItemViewProps extends Omit<React.HTMLAttributes<HTMLButtonElement>, "onFocus"> {
    /** The view model containing all data and callbacks */
    vm: RoomItemViewModel;
    /** Whether the room is currently selected */
    isSelected: boolean;
    /** Whether the room is currently focused */
    isFocused: boolean;
    /** Callback when the item receives focus */
    onFocus: (e: React.FocusEvent) => void;
    /** The index of the room in the list (for accessibility) */
    roomIndex: number;
    /** The total number of rooms in the list (for accessibility) */
    roomCount: number;
    /** Custom avatar component to render */
    avatar: ReactNode;
}

/**
 * A presentational room list item component.
 * Displays room name, avatar, message preview, and notifications.
 */
export const RoomListItemView = memo(function RoomListItemView({
    vm,
    isSelected,
    isFocused,
    onFocus,
    roomIndex,
    roomCount,
    avatar,
    ...props
}: RoomListItemViewProps): JSX.Element {
    const ref = useRef<HTMLButtonElement>(null);
    const item = useViewModel(vm);

    useEffect(() => {
        if (isFocused) {
            ref.current?.focus({ preventScroll: true, focusVisible: true } as FocusOptions);
        }
    }, [isFocused]);

    const content = (
        <Flex
            as="button"
            ref={ref}
            className={classNames(styles.roomListItem, {
                [styles.selected]: isSelected,
                [styles.bold]: item.isBold,
            })}
            gap="var(--cpd-space-3x)"
            align="center"
            type="button"
            role="option"
            aria-posinset={roomIndex + 1}
            aria-setsize={roomCount}
            aria-selected={isSelected}
            aria-label={item.a11yLabel}
            onClick={vm.onOpenRoom}
            onFocus={onFocus}
            tabIndex={isFocused ? 0 : -1}
            {...props}
        >
            {avatar}
            <Flex className={styles.content} gap="var(--cpd-space-2x)" align="center" justify="space-between">
                {/* We truncate the room name when too long. Title here is to show the full name on hover */}
                <div className={styles.text}>
                    <div className={styles.roomName} title={item.name}>
                        {item.name}
                    </div>
                    {item.messagePreview && (
                        <div className={styles.messagePreview} title={item.messagePreview}>
                            {item.messagePreview}
                        </div>
                    )}
                </div>
                {(item.showMoreOptionsMenu || item.showNotificationMenu) && (
                    <RoomListItemHoverMenu
                        showMoreOptionsMenu={item.showMoreOptionsMenu}
                        showNotificationMenu={item.showNotificationMenu}
                        moreOptionsState={item.moreOptionsState}
                        moreOptionsCallbacks={{
                            onMarkAsRead: vm.onMarkAsRead,
                            onMarkAsUnread: vm.onMarkAsUnread,
                            onToggleFavorite: vm.onToggleFavorite,
                            onToggleLowPriority: vm.onToggleLowPriority,
                            onInvite: vm.onInvite,
                            onCopyRoomLink: vm.onCopyRoomLink,
                            onLeaveRoom: vm.onLeaveRoom,
                        }}
                        notificationState={item.notificationState}
                        onSetRoomNotifState={vm.onSetRoomNotifState}
                    />
                )}

                {/* aria-hidden because we summarise the unread count/notification status in a11yLabel */}
                <div className={styles.notificationDecoration} aria-hidden={true}>
                    <NotificationDecoration data={item.notification} />
                </div>
            </Flex>
        </Flex>
    );

    return (
        <RoomListItemContextMenu
            state={item.moreOptionsState}
            callbacks={{
                onMarkAsRead: vm.onMarkAsRead,
                onMarkAsUnread: vm.onMarkAsUnread,
                onToggleFavorite: vm.onToggleFavorite,
                onToggleLowPriority: vm.onToggleLowPriority,
                onInvite: vm.onInvite,
                onCopyRoomLink: vm.onCopyRoomLink,
                onLeaveRoom: vm.onLeaveRoom,
            }}
        >
            {content}
        </RoomListItemContextMenu>
    );
});
