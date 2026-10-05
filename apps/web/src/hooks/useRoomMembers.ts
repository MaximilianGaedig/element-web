/*
Copyright 2024 New Vector Ltd.
Copyright 2020 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { useMemo, useState } from "react";
import { type Room, RoomEvent, type RoomMember, RoomStateEvent } from "matrix-js-sdk/src/matrix";
import { type Membership } from "matrix-js-sdk/src/types";
import { throttle } from "lodash";

import { useTypedEventEmitter } from "./useEventEmitter";
import { getFunctionalMembers } from "../utils/room/getFunctionalMembers";
import { getBridgeBots } from "../utils/bridge/bridgeInfo";

// Hook to simplify watching Matrix Room joined members
export const useRoomMembers = (room: Room, throttleWait = 250): RoomMember[] => {
    const [members, setMembers] = useState<RoomMember[]>(room.getJoinedMembers());

    const throttledUpdate = useMemo(
        () =>
            throttle(
                () => {
                    setMembers(room.getJoinedMembers());
                },
                throttleWait,
                { leading: true, trailing: true },
            ),
        [room, throttleWait],
    );

    useTypedEventEmitter(room.currentState, RoomStateEvent.Members, throttledUpdate);
    return members;
};

type RoomMemberCountOpts = {
    /**
     * Wait time between room member count update
     */
    throttleWait?: number;
    /**
     * Whether to include invited members in the count
     * @default false
     */
    includeInvited?: boolean;
};

/**
 * Returns a count of members in a given room
 * @param room the room to track.
 * @param opts The options.
 * @returns the room member count.
 */
/**
 * How many people are in the room, the bridges' bots and other service accounts left out: they are the
 * plumbing that brings the other network's people in, not people in the chat, and counting them put every
 * bridged group one higher than its own network says (and made a bridged one-to-one chat look like a group).
 * A service account whose membership is not loaded is taken to be in the room, as a bridge's bot always is.
 */
export function peopleCount(room: Room, includeInvited: boolean): number {
    const total = includeInvited ? room.getInvitedAndJoinedMemberCount() : room.getJoinedMemberCount();
    const service = new Set([...getFunctionalMembers(room), ...getBridgeBots(room)]);
    let present = 0;
    for (const userId of service) {
        const membership = room.getMember(userId)?.membership;
        if (membership === undefined || membership === "join" || (includeInvited && membership === "invite")) {
            present++;
        }
    }
    return Math.max(total - present, Math.min(total, 1));
}

export const useRoomMemberCount = (
    room: Room,
    { throttleWait, includeInvited }: RoomMemberCountOpts = { throttleWait: 250, includeInvited: false },
): number => {
    const [count, setCount] = useState<number>(() => peopleCount(room, !!includeInvited));
    const throttledUpdate = useMemo(
        () =>
            throttle(
                () => {
                    setCount(peopleCount(room, !!includeInvited));
                },
                throttleWait,
                { leading: true, trailing: true },
            ),
        [room, throttleWait, includeInvited],
    );

    useTypedEventEmitter(room.currentState, RoomStateEvent.Members, throttledUpdate);

    /**
     * `room.getJoinedMemberCount()` caches the member count behind the room summary
     * So we need to re-compute the member count when the summary gets updated
     */
    useTypedEventEmitter(room, RoomEvent.Summary, throttledUpdate);
    return count;
};

// Hook to simplify watching the local user's membership in a room
export const useMyRoomMembership = (room: Room): Membership => {
    const [membership, setMembership] = useState<Membership>(room.getMyMembership());
    useTypedEventEmitter(room, RoomEvent.MyMembership, () => {
        setMembership(room.getMyMembership());
    });
    return membership;
};
