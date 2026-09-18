/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useCallback, useEffect, useState } from "react";
import { type Room, type RoomMember, RoomMemberEvent } from "matrix-js-sdk/src/matrix";
import { Text } from "@vector-im/compound-web";

import { useEventEmitter } from "../../../hooks/useEventEmitter";
import { useSettingValue } from "../../../hooks/useSettings";
import { usersTypingApartFromMeAndIgnored } from "../../../WhoIsTyping";
import { _t } from "../../../languageHandler";

/** The members of `room` currently typing (not us, not ignored users), kept live. */
export function useTypingMembers(room: Room): RoomMember[] {
    const read = useCallback(() => usersTypingApartFromMeAndIgnored(room), [room]);
    const [members, setMembers] = useState(read);
    useEffect(() => setMembers(read()), [read]);
    // RoomMember typing events are re-emitted on the client.
    useEventEmitter(room.client, RoomMemberEvent.Typing, (_ev: unknown, member?: RoomMember) => {
        if (!member || member.roomId === room.roomId) setMembers(read());
    });
    return members;
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
 */
export function typingText(members: RoomMember[], isDm: boolean): string | undefined {
    if (!members.length) return undefined;
    if (isDm) return _t("beeper|typing_dm");
    if (members.length === 1) return _t("beeper|typing_one", { name: firstName(members[0]) });
    if (members.length === 2) {
        return _t("beeper|typing_two", { name1: firstName(members[0]), name2: firstName(members[1]) });
    }
    return _t("beeper|typing_many", { name: firstName(members[0]), count: members.length - 1 });
}

/** Animated "•••" before the typing text, as in Telegram Web. */
function TypingDots(): JSX.Element {
    return (
        <span className="mx_BeeperTyping_dots" aria-hidden="true">
            <span className="mx_BeeperTyping_dot mx_BeeperTyping_dot_first" />
            <span className="mx_BeeperTyping_dot" />
            <span className="mx_BeeperTyping_dot mx_BeeperTyping_dot_last" />
        </span>
    );
}

/** Returns the header typing text for `room`, or undefined when nobody types (or it's disabled). */
export function useHeaderTypingText(room: Room, isDm: boolean): string | undefined {
    const enabled = useSettingValue("showTypingNotifications");
    const members = useTypingMembers(room);
    return enabled ? typingText(members, isDm) : undefined;
}

/** The typing subtitle itself; renders nothing when nobody is typing. */
export function BeeperTypingSubtitle({ room, isDm }: { room: Room; isDm: boolean }): JSX.Element | null {
    const text = useHeaderTypingText(room, isDm);
    if (!text) return null;
    return <BeeperTypingLine text={text} />;
}

export function BeeperTypingLine({ text }: { text: string }): JSX.Element {
    return (
        <Text as="div" size="sm" className="mx_BeeperLastSeen mx_BeeperTyping" aria-live="polite">
            <TypingDots />
            <span className="mx_BeeperTyping_text">{text}</span>
        </Text>
    );
}
