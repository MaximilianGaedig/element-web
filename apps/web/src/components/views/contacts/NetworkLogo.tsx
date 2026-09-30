/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import BaseAvatar from "../avatars/BaseAvatar";
import { mediaFromMxc } from "../../../customisations/Media";
import { getBridgeInfo } from "../../../utils/bridge/bridgeInfo";

/**
 * The network's own logo, taken from the bridge that carries the chat.
 *
 * The same picture the room header and the room list already show: an `m.bridge` state event names the
 * protocol and carries its avatar, so a bridged chat can say which network it is with the network's mark
 * rather than with two initials in a pill. A chat with no bridge is Matrix itself and needs no badge.
 *
 * Takes the client rather than reading MatrixClientContext, because this is rendered from the contacts
 * list, whose own reason for using the peg (Modal roots do not provide that context) applies here too.
 */
export function NetworkLogo({
    client,
    roomId,
    size,
}: {
    client: MatrixClient;
    roomId?: string;
    size: number;
}): JSX.Element | null {
    /*
     * A badge is worth nothing and a blank panel costs everything, so a room that is not there or has no
     * state read back yet is simply no badge. Every other render-time read of a half-built room in this
     * screen has taken the whole panel down with it, and a logo is the last thing worth that.
     */
    const room = roomId ? client.getRoom(roomId) : null;
    const info = room?.currentState ? getBridgeInfo(room) : undefined;
    if (!info) return null;
    const url = info.avatarUrl
        ? mediaFromMxc(info.avatarUrl, client).getThumbnailOfSourceHttp(size * 2, size * 2, "crop")
        : undefined;
    return (
        <BaseAvatar
            className="mx_Contacts_networkLogo"
            size={`${size}px`}
            name={info.networkName}
            idName={info.protocolId}
            url={url}
            type="square"
            altText={info.networkName}
        />
    );
}
