/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX, memo, type ReactNode } from "react";
import { Text, Tooltip } from "@vector-im/compound-web";
import classNames from "classnames";
import ReplyIcon from "@vector-im/compound-design-tokens/assets/web/icons/reply";

import { Flex } from "../../../../core/utils/Flex";
import { useViewModel } from "../../../../core/viewmodel";
import { NotificationDecoration } from "./NotificationDecoration";
import { RoomListItemHoverMenu } from "./RoomListItemHoverMenu";
import { type Room, type RoomListItemSendState, type RoomListItemViewModel } from "./RoomListItemView";
import styles from "./RoomListItemView.module.css";

/**
 * Props for {@link RoomListItemContent}.
 */
export interface RoomListItemContentProps {
    /** The room item view model */
    vm: RoomListItemViewModel;
    /** Function to render the room avatar */
    renderAvatar: (room: Room) => ReactNode;
    /** Optional function to render the room path (e.g. space breadcrumbs) */
    renderRoomPath?: (room: Room) => ReactNode;
    /** Fork: optional function to render the previewed message's delivery state (its ticks), or who has read it */
    renderSendState?: (
        state: RoomListItemSendState | undefined,
        readers: string[] | undefined,
        room: Room,
    ) => ReactNode;
    /** Whether the item is being dragged */
    isDragging?: boolean;
}

/**
 * The inner content of a room list item: avatar, room name, message preview,
 * hover menu and notification decoration. Used both inside the full
 * {@link RoomListItemView} and inside the drag overlay.
 */
export const RoomListItemContent = memo(function RoomListItemContent({
    vm,
    renderAvatar,
    renderRoomPath,
    renderSendState,
    isDragging = false,
}: RoomListItemContentProps): JSX.Element {
    const item = useViewModel(vm);

    return (
        <Flex
            className={classNames(styles.container, {
                [styles.dragging]: isDragging,
            })}
            gap="var(--cpd-space-3x)"
            align="center"
        >
            {renderAvatar(item.room)}
            <Flex className={styles.content} gap="var(--cpd-space-2x)" align="center" justify="space-between">
                {/* We truncate the room name when too long. Title here is to show the full name on hover */}
                <div className={styles.ellipsis}>
                    {/* Fork: the name line, with the time of the room's last activity at its end, as in Telegram Web */}
                    <div className={styles.nameLine}>
                        <div className={styles.roomName} title={item.name} data-testid="room-name">
                            {item.name}
                            {renderRoomPath?.(item.room)}
                            {item.userStatus && (
                                <Tooltip description={item.userStatus.text} maxWidth="30ch" maxLines={1}>
                                    <Text as="span" className={styles.userStatusEmoji}>
                                        {item.userStatus.emoji}
                                    </Text>
                                </Tooltip>
                            )}
                        </div>
                        {item.lastActivity && (
                            <Text as="span" size="sm" className={styles.time} data-testid="room-time">
                                {item.lastActivity}
                            </Text>
                        )}
                    </div>

                    {/* Fork: the second line - the last message, then its ticks (or who has read it) and the unread
                        badge at its end, as in Telegram Web. Drawn without a preview too, for the badge. */}
                    <Text as="div" size="sm" className={styles.preview} title={item.messagePreview}>
                        {item.messagePreviewThumbnail && item.messagePreviewThumbnailIsReply && (
                            <ReplyIcon
                                className={styles.previewReplyIcon}
                                width="14px"
                                height="14px"
                                aria-hidden={true}
                                data-testid="preview-reply-icon"
                            />
                        )}
                        {item.messagePreviewThumbnail && (
                            <img
                                className={styles.previewThumbnail}
                                src={item.messagePreviewThumbnail}
                                alt=""
                                loading="lazy"
                                decoding="async"
                            />
                        )}
                        <span className={styles.ellipsis}>{item.messagePreview}</span>
                        {(item.messagePreviewSendState || item.messagePreviewReaders?.length) && renderSendState && (
                            <span className={styles.sendState} data-testid="room-send-state">
                                {renderSendState(item.messagePreviewSendState, item.messagePreviewReaders, item.room)}
                            </span>
                        )}
                        {/* aria-hidden because we summarise the unread count/notification status in a11yLabel */}
                        <span className={styles.notificationDecoration} aria-hidden={true}>
                            <NotificationDecoration {...item.notification} />
                        </span>
                    </Text>
                </div>
                {!isDragging && (item.showMoreOptionsMenu || item.showNotificationMenu) && (
                    <RoomListItemHoverMenu
                        showMoreOptionsMenu={item.showMoreOptionsMenu}
                        showNotificationMenu={item.showNotificationMenu}
                        vm={vm}
                    />
                )}
            </Flex>
        </Flex>
    );
});
