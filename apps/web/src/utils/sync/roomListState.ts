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
 * the store when the room is opened: MatrixClient.loadStoredRoomState, or under sliding sync asked for with the
 * room's subscription (OPEN_ROOM_STATE).
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

/**
 * The state an open room reads on top of the room list's: its header, pins, settings, widgets and the bridge's
 * per-chat features. Sliding sync asks for it, by type, when a room is opened (its room subscription); sync v2
 * reads it from the store instead (MatrixClient.loadStoredRoomState).
 *
 * By type, because `["*", "*"]` alone is not enough: tuwunel matches the event type literally, so a "*" type
 * brings no state at all. Types whose state key is not always empty are asked for with all of their keys.
 */
export const OPEN_ROOM_STATE: ReadonlyArray<[string, string]> = [
    [EventType.RoomTopic, ""],
    [EventType.RoomPinnedEvents, ""],
    [EventType.RoomHistoryVisibility, ""],
    [EventType.RoomGuestAccess, ""],
    [EventType.RoomServerAcl, ""],
    [EventType.RoomThirdPartyInvite, "*"],
    // WIDGET_LAYOUT_EVENT_TYPE
    ["io.element.widgets.layout", ""],
    // JitsiCallMemberEventType
    ["io.element.video.member", "*"],
    // Room sticker and emoji packs (utils/bridge/imagePacks)
    ["m.room.image_pack", "*"],
    ["im.ponies.room_emotes", "*"],
    // Bridge: ROOM_FEATURES_EVENT_TYPE, BRIDGE_SETTINGS_EVENT_TYPE, BOT_COMMANDS_EVENT_TYPE, DISAPPEARING_TIMER_KEY,
    // BACKFILL_SUMMARY_EVENT_TYPE. Written as strings: their modules are too heavy to import on the sync path.
    ["com.beeper.room_features", "*"],
    ["im.mxg.settings", "*"],
    ["fi.mau.telegram.bot_commands", ""],
    ["com.beeper.disappearing_timer", ""],
    ["im.mxg.backfill_summary", ""],
];
