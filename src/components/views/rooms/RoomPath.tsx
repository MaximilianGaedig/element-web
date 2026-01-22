/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 */

import React, { memo } from "react";
import classNames from "classnames";
import { type Room } from "matrix-js-sdk/src/matrix";

import { useRoomPath } from "../../../hooks/useRoomPath";
import { useSettingValue } from "../../../hooks/useSettings";
import RoomAvatar from "../avatars/RoomAvatar";

interface Props {
    /** The room to show the path for. */
    room: Room;
    /** Optional class name to apply to the container. */
    className?: string;
    /** Optional mode to override the setting. */
    mode?: "inline" | "under";
    /** Whether to show a separator before the first entry in inline mode. */
    showSeparatorBefore?: boolean;
}

/**
 * Component to show the space path of a room.
 *
 * Used in RoomTile to show breadcrumbs like Space > SubSpace > #room.
 */
export const RoomPath: React.FC<Props> = memo(({ room, className, mode, showSeparatorBefore = false }) => {
    const showPathSetting = useSettingValue<"RoomList.showSpacePath">("RoomList.showSpacePath");
    const showPath = (mode ?? showPathSetting) as string;
    const showIcons = useSettingValue<"RoomList.showSpacePathIcons">("RoomList.showSpacePathIcons");
    const path = useRoomPath(room);

    if (showPath === "none" || path.length === 0) {
        return null;
    }

    return (
        <div
            className={classNames("mx_RoomPath", className, {
                mx_RoomPath_inline: showPath === "inline",
                mx_RoomPath_under: showPath === "under",
            })}
        >
            {path.map((entry, i) => {
                const isFirstLeading = i === 0 && showPath === "inline" && showSeparatorBefore;
                return (
                    <React.Fragment key={entry.id}>
                        {(i > 0 || isFirstLeading) && (
                            <span
                                className={classNames("mx_RoomPath_separator", {
                                    mx_RoomPath_separator_first: isFirstLeading,
                                })}
                            >
                                {isFirstLeading ? "\u00A0" : " > "}
                            </span>
                        )}
                        <span className="mx_RoomPath_entry" title={entry.name}>
                            {showIcons && <RoomAvatar room={entry.room} size="12px" className="mx_RoomPath_icon" />}
                            <span className="mx_RoomPath_name">{entry.name}</span>
                        </span>
                    </React.Fragment>
                );
            })}
        </div>
    );
});
