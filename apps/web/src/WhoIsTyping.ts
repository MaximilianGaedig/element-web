/*
Copyright 2024 New Vector Ltd.
Copyright 2017 Vector Creations Ltd

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type Room, type RoomMember } from "matrix-js-sdk/src/matrix";

import { _t } from "./languageHandler";
import { type TypingActivity, type TypingKind } from "./TypingKinds";

export function usersTypingApartFromMeAndIgnored(room: Room): RoomMember[] {
    return usersTyping(room, [room.client.getSafeUserId()].concat(room.client.getIgnoredUsers()));
}

export function usersTypingApartFromMe(room: Room): RoomMember[] {
    return usersTyping(room, [room.client.getSafeUserId()]);
}

/**
 * Given a Room object and, optionally, a list of userID strings
 * to exclude, return a list of user objects who are typing.
 * @param {Room} room: room object to get users from.
 * @param {string[]} exclude: list of user mxids to exclude.
 * @returns {RoomMember[]} list of user objects who are typing.
 */
export function usersTyping(room: Room, exclude: string[] = []): RoomMember[] {
    const whoIsTyping: RoomMember[] = [];

    const memberKeys = Object.keys(room.currentState.members);
    for (const userId of memberKeys) {
        if (room.currentState.members[userId].typing) {
            if (exclude.indexOf(userId) === -1) {
                whoIsTyping.push(room.currentState.members[userId]);
            }
        }
    }

    return whoIsTyping;
}

/** "Ada is recording a voice message …": the line for one person doing something other than typing text. */
function oneUserActivityString(displayName: string, kind: TypingActivity): string {
    switch (kind) {
        case "recording_voice":
            return _t("timeline|typing_indicator|one_user_kind|recording_voice", { displayName });
        case "recording_video":
            return _t("timeline|typing_indicator|one_user_kind|recording_video", { displayName });
        case "uploading_photo":
            return _t("timeline|typing_indicator|one_user_kind|uploading_photo", { displayName });
        case "uploading_video":
            return _t("timeline|typing_indicator|one_user_kind|uploading_video", { displayName });
        case "uploading_file":
            return _t("timeline|typing_indicator|one_user_kind|uploading_file", { displayName });
        case "uploading_voice":
            return _t("timeline|typing_indicator|one_user_kind|uploading_voice", { displayName });
        case "choosing_sticker":
            return _t("timeline|typing_indicator|one_user_kind|choosing_sticker", { displayName });
    }
}

/**
 * The typing line for the given members.
 * @param whoIsTyping the members to name.
 * @param limit how many names the line has room for.
 * @param kindOf what a member is doing, if that is known. One person doing something other than typing
 * text is said to be doing it; several people are typing, as the line has room for one activity.
 */
export function whoIsTypingString(
    whoIsTyping: RoomMember[],
    limit: number,
    kindOf?: (member: RoomMember) => TypingKind,
): string {
    let othersCount = 0;
    if (whoIsTyping.length > limit) {
        othersCount = whoIsTyping.length - limit + 1;
    }

    if (whoIsTyping.length === 0) {
        return "";
    } else if (whoIsTyping.length === 1) {
        const kind = kindOf?.(whoIsTyping[0]) ?? "text";
        if (kind !== "text") return oneUserActivityString(whoIsTyping[0].name, kind);
        return _t("timeline|typing_indicator|one_user", { displayName: whoIsTyping[0].name });
    }

    const names = whoIsTyping.map((m) => m.name);

    if (othersCount >= 1) {
        return _t("timeline|typing_indicator|more_users", {
            names: names.slice(0, limit - 1).join(", "),
            count: othersCount,
        });
    } else {
        const lastPerson = names.pop();
        return _t("timeline|typing_indicator|two_users", { names: names.join(", "), lastPerson: lastPerson });
    }
}
