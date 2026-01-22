/*
 * Copyright 2025 New Vector Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX, memo, useEffect, useRef } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";
import classNames from "classnames";
import { Flex } from "@element-hq/web-shared-components";

import { useRoomListItemViewModel } from "../../../viewmodels/roomlist/RoomListItemViewModel";
import { RoomListItemMenuView } from "./RoomListItemMenuView";
import { NotificationDecoration } from "../NotificationDecoration";
import { RoomAvatarView } from "../../avatars/RoomAvatarView";
import { RoomListItemContextMenuView } from "./RoomListItemContextMenuView";
import { RoomPath } from "../RoomPath";
import { useSettingValue } from "../../../../hooks/useSettings";

interface RoomListItemViewProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onFocus"> {
    /**
     * The room to display
     */
    room: Room;
    /**
     * Whether the room is selected
     */
    isSelected: boolean;
    /**
     * Whether the room is focused
     */
    isFocused: boolean;
    /**
     * A callback that indicates the item has received focus
     */
    onFocus: (room: Room, e: React.FocusEvent) => void;
    /**
     * The index of the room in the list
     */
    roomIndex: number;
    /**
     * The total number of rooms in the list
     */
    roomCount: number;
}

/**
 * An item in the room list
 */
export const RoomListItemView = memo(function RoomListItemView({
    room,
    isSelected,
    isFocused,
    onFocus,
    roomIndex: index,
    roomCount: count,
    ...props
}: RoomListItemViewProps): JSX.Element {
    const ref = useRef<HTMLDivElement>(null);
    const vm = useRoomListItemViewModel(room);
    const showPath = useSettingValue<"RoomList.showSpacePath">("RoomList.showSpacePath");

    useEffect(() => {
        if (isFocused) {
            ref.current?.focus({ preventScroll: true, focusVisible: true });
        }
    }, [isFocused]);

    const content = (
        <Flex
            as="div"
            ref={ref}
            className={classNames("mx_RoomListItemView", {
                mx_RoomListItemView_has_menu: vm.showHoverMenu,
                mx_RoomListItemView_selected: isSelected,
                mx_RoomListItemView_bold: vm.isBold,
            })}
            gap="var(--cpd-space-3x)"
            align="stretch"
            role="option"
            aria-posinset={index + 1}
            aria-setsize={count}
            aria-selected={isSelected}
            aria-label={vm.a11yLabel}
            onClick={() => vm.openRoom()}
            onKeyDown={(e: React.KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    vm.openRoom();
                }
            }}
            onFocus={(e: React.FocusEvent<HTMLDivElement>) => onFocus(room, e)}
            tabIndex={isFocused ? 0 : -1}
            {...props}
        >
            <div className="mx_RoomListItemView_avatarWrapper">
                <RoomAvatarView room={room} />
            </div>
            <Flex
                className="mx_RoomListItemView_content"
                gap="var(--cpd-space-2x)"
                align="stretch"
                justify="space-between"
            >
                {/* We truncate the room name when too long. Title here is to show the full name on hover */}
                <div className="mx_RoomListItemView_text">
                    <div className="mx_RoomListItemView_nameWrapper">
                        <div className="mx_RoomListItemView_roomName" title={vm.name}>
                            {vm.name}
                        </div>
                        {showPath === "inline" && <RoomPath room={room} showSeparatorBefore={true} />}
                    </div>
                    {showPath === "under" && <RoomPath room={room} />}
                    {vm.messagePreview && (
                        <div className="mx_RoomListItemView_messagePreview" title={vm.messagePreview}>
                            {vm.messagePreview}
                        </div>
                    )}
                </div>
                {vm.showHoverMenu && <RoomListItemMenuView className="mx_RoomListItemView_menu" room={room} />}

                {/* aria-hidden because we summarise the unread count/notification status in a11yLabel variable */}
                {vm.showNotificationDecoration && (
                    <NotificationDecoration
                        className="mx_RoomListItemView_notificationDecoration"
                        notificationState={vm.notificationState}
                        aria-hidden={true}
                        callType={vm.callType}
                    />
                )}
            </Flex>
        </Flex>
    );

    if (!vm.showContextMenu) return content;
    return <RoomListItemContextMenuView room={room}>{content}</RoomListItemContextMenuView>;
});
