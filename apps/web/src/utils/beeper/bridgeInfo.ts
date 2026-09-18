/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type Room } from "matrix-js-sdk/src/matrix";

import { _t } from "../../languageHandler";

/** MSC2346 bridge info; mautrix sends both types with the same content. */
const BRIDGE_EVENT_TYPES = ["m.bridge", "uk.half-shot.bridge"];

/** bridgev2 portal room types (com.beeper.room_type.v2); "" is an ordinary group chat. */
export type BridgeRoomType = "dm" | "group_dm" | "space" | "group";

export interface BridgeInfo {
    /** Protocol id, e.g. "telegram", "whatsapp", "discord". */
    protocolId: string;
    /** Human-readable network name, e.g. "Telegram". */
    networkName: string;
    /** mxc:// icon of the network, if the bridge set one. */
    avatarUrl?: string;
    roomType: BridgeRoomType;
    /** The containing remote space, e.g. a Discord server, if any. */
    parentName?: string;
}

function str(value: unknown): string | undefined {
    return typeof value === "string" && value ? value : undefined;
}

/** The room's bridge info, or undefined for rooms that aren't bridged. */
export function getBridgeInfo(room: Room): BridgeInfo | undefined {
    for (const type of BRIDGE_EVENT_TYPES) {
        for (const ev of room.currentState.getStateEvents(type)) {
            const content = ev.getContent();
            const protocol = content.protocol;
            const protocolId = str(protocol?.id);
            if (!protocolId) continue;
            const v2 = content["com.beeper.room_type.v2"];
            let roomType: BridgeRoomType = "group";
            if (v2 === "dm" || v2 === "group_dm" || v2 === "space") roomType = v2;
            else if (content["com.beeper.room_type"] === "dm") roomType = "dm";
            const avatar = str(protocol.avatar_url);
            return {
                protocolId,
                networkName: str(protocol.displayname) ?? protocolId,
                avatarUrl: avatar?.startsWith("mxc://") ? avatar : undefined,
                roomType,
                parentName: str(content.network?.displayname),
            };
        }
    }
    return undefined;
}

/** "Telegram · Direct message", "Discord · My Server · Group chat", ... */
export function describeBridge(info: BridgeInfo): string {
    const type = {
        dm: _t("beeper|room_type_dm"),
        group_dm: _t("beeper|room_type_group_dm"),
        space: _t("beeper|room_type_space"),
        group: _t("beeper|room_type_group"),
    }[info.roomType];
    return _t("beeper|bridged_from", {
        description: [info.networkName, info.parentName, type].filter(Boolean).join(" · "),
    });
}
