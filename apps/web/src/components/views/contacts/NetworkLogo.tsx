/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import BaseAvatar from "../avatars/BaseAvatar";
import { mediaFromMxc } from "../../../customisations/Media";
import { type BridgeInfo, getBridgeInfo } from "../../../utils/bridge/bridgeInfo";

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
/** Networks already found by name, per client: a list of hundreds asks for the same few over and over. */
const byName = new WeakMap<MatrixClient, Map<string, BridgeInfo>>();

/**
 * A network's bridge info from any chat it carries, for an account that has no chat of its own.
 *
 * Most of a network's contact list is people nobody has messaged yet: they have an account and no room, and
 * reading the network off the room left them without a badge while the same person's chat had one. Any
 * room the same bridge carries names the same network with the same picture. Only found answers are kept,
 * so a lookup made before the rooms arrived is made again.
 */
export function bridgeInfoForNetwork(client: MatrixClient, network: string): BridgeInfo | undefined {
    const wanted = network.toLowerCase();
    let known = byName.get(client);
    const held = known?.get(wanted);
    if (held) return held;
    for (const room of client.getRooms?.() ?? []) {
        if (!room.currentState) continue;
        const info = getBridgeInfo(room);
        if (info && (info.networkName.toLowerCase() === wanted || info.protocolId.toLowerCase() === wanted)) {
            if (!known) byName.set(client, (known = new Map()));
            known.set(wanted, info);
            return info;
        }
    }
    return undefined;
}

export function NetworkLogo({
    client,
    roomId,
    network,
    size,
}: {
    client: MatrixClient;
    roomId?: string;
    /** The account's network, for when it has no chat to read one from. */
    network?: string;
    size: number;
}): JSX.Element | null {
    /*
     * A badge is worth nothing and a blank panel costs everything, so a room that is not there or has no
     * state read back yet is simply no badge. Every other render-time read of a half-built room in this
     * screen has taken the whole panel down with it, and a logo is the last thing worth that.
     */
    const room = roomId ? client.getRoom(roomId) : null;
    const info =
        (room?.currentState ? getBridgeInfo(room) : undefined) ??
        (network ? bridgeInfoForNetwork(client, network) : undefined);
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
