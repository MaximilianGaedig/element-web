/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { EventType, UNSTABLE_ELEMENT_FUNCTIONAL_USERS } from "matrix-js-sdk/src/matrix";

import { BACKFILL_EVENT_TYPE } from "../chatHistory";
import { BRIDGE_LOGIN_EVENT_TYPE } from "../bridgeLogins";

/**
 * The state every room keeps in memory, for the room list, spaces, calls, notifications and encryption.
 * Everything else (members beyond the ones shown, topics, sticker packs, bridge features, …) is read from
 * the store when the room is opened: MatrixClient.loadStoredRoomState.
 */
export const ROOM_LIST_STATE_TYPES: string[] = [
    EventType.RoomCreate,
    EventType.RoomName,
    EventType.RoomAvatar,
    EventType.RoomCanonicalAlias,
    EventType.RoomEncryption,
    EventType.RoomTombstone,
    EventType.RoomJoinRules,
    EventType.RoomPowerLevels,
    EventType.SpaceChild,
    EventType.SpaceParent,
    EventType.GroupCallPrefix,
    EventType.GroupCallMemberPrefix,
    EventType.RTCMembership,
    "org.matrix.msc3946.room_predecessor",
    "im.vector.modular.widgets",
    // Bridge info: the room list's network badges and bridged-DM detection
    "m.bridge",
    "uk.half-shot.bridge",
    // Who in the room is not a person (the bridge bot, your own ghost). A trimmed room keeps the member
    // events of whoever sent its last events, and a bridge bot sends delivery statuses after each of
    // your messages: without this the chat counts as three people, and gets no name or picture from
    // the one you are talking to.
    UNSTABLE_ELEMENT_FUNCTIONAL_USERS.name,
    // Bridge status: history import per chat, and whether each bridge is connected. These are written
    // once and not repeated, so a sync that omits them would leave the chat list and dashboard blind.
    BACKFILL_EVENT_TYPE,
    BRIDGE_LOGIN_EVENT_TYPE,
];

/**
 * Of those, the ones a room has only one of (the empty state key). Sliding sync asks for each type with a
 * state key; everything not listed here is asked for with all of its keys.
 */
const SINGLE_STATE: ReadonlySet<string> = new Set([
    EventType.RoomCreate,
    EventType.RoomName,
    EventType.RoomAvatar,
    EventType.RoomCanonicalAlias,
    EventType.RoomEncryption,
    EventType.RoomTombstone,
    EventType.RoomJoinRules,
    EventType.RoomPowerLevels,
    "org.matrix.msc3946.room_predecessor",
    UNSTABLE_ELEMENT_FUNCTIONAL_USERS.name,
    BACKFILL_EVENT_TYPE,
]);

/**
 * The room-list state as sliding sync's `required_state`: the same list both ways of syncing read from, so
 * that a type added for the chat list is there whichever is in use. With it, the member events the list
 * needs: our own, and those of whoever sent the latest messages (`$LAZY`).
 */
export function roomListRequiredState(): [string, string][] {
    return [
        ...ROOM_LIST_STATE_TYPES.map((type): [string, string] => [type, SINGLE_STATE.has(type) ? "" : "*"]),
        [EventType.RoomMember, "$ME"],
        [EventType.RoomMember, "$LAZY"],
    ];
}
