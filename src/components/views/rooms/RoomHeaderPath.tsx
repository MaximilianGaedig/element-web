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
import SpaceStore from "../../../stores/spaces/SpaceStore";
import AccessibleButton from "../elements/AccessibleButton";

interface Props {
    /** The room to show the path for. */
    room: Room;
    /** Optional class name to apply to the container. */
    className?: string;
}

/**
 * Component to show the space path of a room in the room header.
 *
 * Each entry in the path is clickable and switches the active space.
 */
export const RoomHeaderPath: React.FC<Props> = memo(({ room, className }) => {
    const enabled = useSettingValue<"RoomHeader.showSpacePath">("RoomHeader.showSpacePath");
    const showIcons = useSettingValue<"RoomList.showSpacePathIcons">("RoomList.showSpacePathIcons");
    const path = useRoomPath(room);

    if (!enabled || path.length === 0) {
        return null;
    }

    const onSpaceClick = (spaceId: string): void => {
        SpaceStore.instance.setActiveSpace(spaceId);
    };

    return (
        <div className={classNames("mx_RoomHeaderPath", className)}>
            {path.map((entry, i) => {
                return (
                    <React.Fragment key={entry.id}>
                        {i > 0 && <span className="mx_RoomHeaderPath_separator">{" > "}</span>}
                        <AccessibleButton
                            className="mx_RoomHeaderPath_entry"
                            onClick={() => onSpaceClick(entry.id)}
                            title={entry.name}
                        >
                            {showIcons && (
                                <RoomAvatar room={entry.room} size="12px" className="mx_RoomHeaderPath_icon" />
                            )}
                            <span className="mx_RoomHeaderPath_name">{entry.name}</span>
                        </AccessibleButton>
                    </React.Fragment>
                );
            })}
        </div>
    );
});
