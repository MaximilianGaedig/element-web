/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, type ReactNode, useContext } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";
import { Tooltip } from "@vector-im/compound-web";

import BaseAvatar from "../avatars/BaseAvatar";
import MatrixClientContext from "../../../contexts/MatrixClientContext";
import { mediaFromMxc } from "../../../customisations/Media";
import { useRoomState } from "../../../hooks/useRoomState";
import { type BridgeInfo, describeBridge, getBridgeInfo } from "../../../utils/beeper/bridgeInfo";

/** The network's icon (or its initial) at the given pixel size. */
export function BridgeNetworkIcon({ info, size }: { info: BridgeInfo; size: number }): JSX.Element {
    const cli = useContext(MatrixClientContext);
    const url = info.avatarUrl
        ? mediaFromMxc(info.avatarUrl, cli).getThumbnailOfSourceHttp(size * 2, size * 2, "crop")
        : undefined;
    return (
        <BaseAvatar
            className="mx_BridgeNetworkIcon"
            size={`${size}px`}
            name={info.networkName}
            idName={info.protocolId}
            url={url}
            type="square"
            altText=""
        />
    );
}

/** Room header badge naming the network a bridged room comes from (m.bridge + com.beeper.room_type). */
// Icon only: the room-path breadcrumb under the room name already names the
// network (e.g. "Telegram (…)"), so repeating it as text is redundant.
export function BridgeNetworkHeaderBadge({ room }: { room: Room }): JSX.Element | null {
    const info = useRoomState(room, () => getBridgeInfo(room));
    if (!info) return null;
    const label = describeBridge(info);
    return (
        <Tooltip label={label} placement="right">
            <span className="mx_BeeperRoomHeaderBadge mx_BridgeNetworkHeaderBadge" aria-label={label}>
                <BridgeNetworkIcon info={info} size={16} />
            </span>
        </Tooltip>
    );
}

/** Wraps a room avatar in the room list with a small network icon in its corner. */
export function BridgedRoomAvatar({ room, children }: { room: Room; children: ReactNode }): JSX.Element {
    const info = useRoomState(room, () => getBridgeInfo(room));
    if (!info) return <>{children}</>;
    return (
        <span className="mx_BridgedRoomAvatar" title={describeBridge(info)}>
            {children}
            <BridgeNetworkIcon info={info} size={14} />
        </span>
    );
}
