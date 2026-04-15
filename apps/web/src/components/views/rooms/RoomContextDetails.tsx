/*
 * Copyright 2026 Element Creations Ltd.
 * Copyright 2024 New Vector Ltd.
 * Copyright 2022 The Matrix.org Foundation C.I.C.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { type Room } from "matrix-js-sdk/src/matrix";
import React, { type JSX, type HTMLAttributes } from "react";

import { roomContextDetails } from "../../../utils/i18n-helpers";
import { RoomPath } from "./RoomPath";
import { useSettingValue } from "../../../hooks/useSettings";

type Props<T extends keyof HTMLElementTagNameMap> = HTMLAttributes<T> & {
    component?: T;
    room: Room;
};

export function RoomContextDetails<T extends keyof HTMLElementTagNameMap>({
    room,
    component,
    ...other
}: Props<T>): JSX.Element {
    // @ts-ignore
    const showPath = useSettingValue("RoomList.showSpacePath");
    const contextDetails = roomContextDetails(room);

    if (showPath !== "none" && !room.isSpaceRoom()) {
        return React.createElement(
            component ?? "div",
            {
                ...other,
            },
            <RoomPath room={room} mode="inline" showSeparatorBefore={true} />,
        );
    }

    if (contextDetails) {
        return React.createElement(
            component ?? "div",
            {
                ...other,
                "aria-label": contextDetails.ariaLabel,
            },
            [contextDetails.details],
        );
    }

    return <></>;
}
