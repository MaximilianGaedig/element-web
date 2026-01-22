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
import { _t } from "../../i18n/translation";

/**
 * Generate an accessible label for a room based on its notification state.
 */
function getA11yLabel(roomName: string, notification: NotificationDecorationData): string {
    if (notification.isUnsentMessage) {
        return _t("room_list|a11y|unsent_message", { roomName });
    } else if (notification.invited) {
        return _t("room_list|a11y|invitation", { roomName });
    } else if (notification.isMention) {
        const count = notification.count ?? 0;
        return count === 1
            ? _t("room_list|a11y|mention_one", { roomName })
            : _t("room_list|a11y|mention_other", { roomName, count });
    } else if (notification.hasUnreadCount) {
        const count = notification.count ?? 0;
        return count === 1
            ? _t("room_list|a11y|unread_one", { roomName })
            : _t("room_list|a11y|unread_other", { roomName, count });
    } else {
        return _t("room_list|a11y|default", { roomName });
    }
}

/**
 * Snapshot for a room list item.
 * Contains all the data needed to render a room in the list.
 */
export interface RoomListItemSnapshot {
    /** Unique identifier for the room (used for list keying) */
    id: string;
    /** The opaque Room object from the client (e.g., matrix-js-sdk Room) */
    room: any;
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
}

/**
 * The view model type for a room list item
 */
export type RoomItemViewModel = ViewModel<RoomListItemSnapshot> & RoomListItemActions;

/**
 * Props for RoomListItemView component
 */
export interface RoomListItemViewProps extends Omit<React.HTMLAttributes<HTMLButtonElement>, "onFocus"> {
    /** The room item view model */
    vm: RoomItemViewModel;
    /** Whether the room is selected */
    isSelected: boolean;
    /** Whether the room should be focused */
    isFocused: boolean;
    /** Callback when item receives focus */
    onFocus: (room: any, e: React.FocusEvent) => void;
    /** Index of this room in the list (for accessibility) */
    roomIndex: number;
    /** Total number of rooms in the list (for accessibility) */
    roomCount: number;
    /** Function to render the room avatar */
    renderAvatar: (room: any) => ReactNode;
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
    renderAvatar,
    ...props
}: RoomListItemViewProps): JSX.Element {
    const ref = useRef<HTMLButtonElement>(null);
    const item = useViewModel(vm);

    useEffect(() => {
        if (isFocused) {
            ref.current?.focus({ preventScroll: true, focusVisible: true } as FocusOptions);
        }
    }, [isFocused]);

    // Generate a11y label from notification state and room name
    const a11yLabel = getA11yLabel(item.name, item.notification);

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
            aria-label={a11yLabel}
            onClick={vm.onOpenRoom}
            onFocus={(e: React.FocusEvent<HTMLButtonElement>) => onFocus(item.room, e)}
            tabIndex={isFocused ? 0 : -1}
            {...props}
        >
            {renderAvatar(item.room)}
            <Flex className={styles.content} gap="var(--cpd-space-2x)" align="center" justify="space-between">
                {/* We truncate the room name when too long. Title here is to show the full name on hover */}
                <div className={styles.text}>
                    <div className={styles.roomName} title={item.name} data-testid="room-name">
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
