/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useCallback, useEffect, useReducer, useState } from "react";
import { type Room, type RoomMember, RoomMemberEvent } from "matrix-js-sdk/src/matrix";
import { Text } from "@vector-im/compound-web";

import { useEventEmitter } from "../../../hooks/useEventEmitter";
import { useSettingValue } from "../../../hooks/useSettings";
import { usersTypingApartFromMeAndIgnored } from "../../../WhoIsTyping";
import { _t } from "../../../languageHandler";
import {
    onTypingKindsChanged,
    type TypingActivity,
    type TypingKind,
    typingKindOf,
    watchTypingKinds,
} from "../../../TypingKinds";

/** The members of `room` currently typing (not us, not ignored users), kept live. */
function useTypingMembers(room: Room): RoomMember[] {
    const read = useCallback(() => usersTypingApartFromMeAndIgnored(room), [room]);
    const [members, setMembers] = useState(read);
    useEffect(() => setMembers(read()), [read]);
    // RoomMember typing events are re-emitted on the client.
    useEventEmitter(room.client, RoomMemberEvent.Typing, (_ev: unknown, member?: RoomMember) => {
        if (!member || member.roomId === room.roomId) setMembers(read());
    });
    return members;
}

/**
 * What a member of `room` is doing while typing, kept live: somebody can go from typing to recording
 * a voice message without the list of typing members changing.
 */
function useTypingKindOf(room: Room): (member: RoomMember) => TypingKind {
    const [, changed] = useReducer((count: number) => count + 1, 0);
    useEffect(() => {
        watchTypingKinds(room.client);
        return onTypingKindsChanged((roomId) => {
            if (roomId === room.roomId) changed();
        });
    }, [room]);
    return (member) => typingKindOf(room, member.userId);
}

/** "recording a voice message": what the other side of a DM is doing other than typing text. */
function dmActivityText(kind: TypingActivity): string {
    switch (kind) {
        case "recording_voice":
            return _t("bridge|typing_kind_dm|recording_voice");
        case "recording_video":
            return _t("bridge|typing_kind_dm|recording_video");
        case "uploading_photo":
            return _t("bridge|typing_kind_dm|uploading_photo");
        case "uploading_video":
            return _t("bridge|typing_kind_dm|uploading_video");
        case "uploading_file":
            return _t("bridge|typing_kind_dm|uploading_file");
        case "uploading_voice":
            return _t("bridge|typing_kind_dm|uploading_voice");
        case "choosing_sticker":
            return _t("bridge|typing_kind_dm|choosing_sticker");
    }
}

/** "Ada is recording a voice message": what one member of a group is doing other than typing text. */
function oneActivityText(name: string, kind: TypingActivity): string {
    switch (kind) {
        case "recording_voice":
            return _t("bridge|typing_kind_one|recording_voice", { name });
        case "recording_video":
            return _t("bridge|typing_kind_one|recording_video", { name });
        case "uploading_photo":
            return _t("bridge|typing_kind_one|uploading_photo", { name });
        case "uploading_video":
            return _t("bridge|typing_kind_one|uploading_video", { name });
        case "uploading_file":
            return _t("bridge|typing_kind_one|uploading_file", { name });
        case "uploading_voice":
            return _t("bridge|typing_kind_one|uploading_voice", { name });
        case "choosing_sticker":
            return _t("bridge|typing_kind_one|choosing_sticker", { name });
    }
}

/** Telegram shows only the first name in "X is typing". */
function firstName(member: RoomMember): string {
    const name = member.rawDisplayName || member.name || member.userId;
    return name.trim().split(/\s+/)[0] || name;
}

/**
 * The typing line Telegram Web shows in the chat header: "typing" in a DM, "Name is typing",
 * "A and B are typing" or "A and N others are typing" in groups.
 * (Wording/logic follows Telegram Web K's appImManager.getPeerTyping, GPL-3.0.)
 *
 * One person doing something other than typing text ("recording a voice message", "sending a photo")
 * is said to be doing it, as Telegram does; several people are typing.
 */
export function typingText(
    members: RoomMember[],
    isDm: boolean,
    kindOf?: (member: RoomMember) => TypingKind,
): string | undefined {
    if (!members.length) return undefined;
    const kind = members.length === 1 ? (kindOf?.(members[0]) ?? "text") : "text";
    if (isDm) return kind === "text" ? _t("bridge|typing_dm") : dmActivityText(kind);
    if (members.length === 1) {
        const name = firstName(members[0]);
        return kind === "text" ? _t("bridge|typing_one", { name }) : oneActivityText(name, kind);
    }
    if (members.length === 2) {
        return _t("bridge|typing_two", { name1: firstName(members[0]), name2: firstName(members[1]) });
    }
    return _t("bridge|typing_many", { name: firstName(members[0]), count: members.length - 1 });
}

/** Animated "•••" before the typing text, as in Telegram Web. */
function TypingDots(): JSX.Element {
    return (
        <span className="mx_TypingIndicator_dots" aria-hidden="true">
            <span className="mx_TypingIndicator_dot mx_TypingIndicator_dot_first" />
            <span className="mx_TypingIndicator_dot" />
            <span className="mx_TypingIndicator_dot mx_TypingIndicator_dot_last" />
        </span>
    );
}

/** Returns the header typing text for `room`, or undefined when nobody types (or it's disabled). */
export function useHeaderTypingText(room: Room, isDm: boolean): string | undefined {
    const enabled = useSettingValue("showTypingNotifications");
    const members = useTypingMembers(room);
    const kindOf = useTypingKindOf(room);
    return enabled ? typingText(members, isDm, kindOf) : undefined;
}

/** The typing subtitle itself; renders nothing when nobody is typing. */
export function TypingSubtitle({ room, isDm }: { room: Room; isDm: boolean }): JSX.Element | null {
    const text = useHeaderTypingText(room, isDm);
    if (!text) return null;
    return <TypingIndicatorLine text={text} />;
}

export function TypingIndicatorLine({ text }: { text: string }): JSX.Element {
    return (
        <Text as="div" size="sm" className="mx_LastSeen mx_TypingIndicator" aria-live="polite">
            <TypingDots />
            <span className="mx_TypingIndicator_text">{text}</span>
        </Text>
    );
}
