/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The rooms a person is in with you, and the calls you have had with them.
 *
 * Both answer the same question from the card - "what do I have with this person" - and both are read from
 * what the client already holds rather than asked for: the rooms it has synced and the timelines it has
 * loaded. A merged contact is several accounts, so both look for all of them, which is the thing this card
 * can say that a single member's profile cannot.
 */

import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";

import { type Call } from "./calls";
import { type Person } from "./people";

/** Every Matrix ID this person is, for asking whether a room holds them. */
const idsOf = (person: Person): Set<string> =>
    new Set(person.accounts.map((account) => account.mxid).filter((mxid): mxid is string => !!mxid));

export interface SharedRoom {
    roomId: string;
    name: string;
    avatarUrl?: string;
    /** How many people are in it, which is what tells a group from a pair. */
    members: number;
}

/**
 * The groups you are both in, newest activity first.
 *
 * The one-to-one chats are left out: those are the accounts, which the card lists above this as the ways
 * to reach them. What is left is the rooms where this person is somebody you both know, which is the part
 * a contact list cannot otherwise show - and the reason the same name keeps appearing in a room you forgot
 * you shared.
 */
export function sharedRooms(client: MatrixClient, person: Person): SharedRoom[] {
    const ids = idsOf(person);
    if (!ids.size) return [];
    const dms = new Set(person.rooms);
    const found: { room: Room; ts: number }[] = [];
    for (const room of client.getVisibleRooms()) {
        if (dms.has(room.roomId)) continue;
        if (room.getJoinedMemberCount() + room.getInvitedMemberCount() <= 2) continue;
        if (![...ids].some((mxid) => room.getMember(mxid)?.membership === "join")) continue;
        found.push({ room, ts: room.getLastLiveEvent()?.getTs() ?? 0 });
    }
    return found
        .sort((a, b) => b.ts - a.ts)
        .map(({ room }) => ({
            roomId: room.roomId,
            name: room.name,
            avatarUrl: room.getMxcAvatarUrl() ?? undefined,
            members: room.getJoinedMemberCount(),
        }));
}

/**
 * The calls with this person, newest first, whichever of their accounts it was with.
 *
 * Filtered from the same history the calls list is built from rather than walked again: one read of the
 * timelines answers both, and a call that the list shows and the card does not would be the two disagreeing
 * about what happened.
 */
export function callsWith(calls: readonly Call[], person: Person, limit = 5): Call[] {
    const ids = idsOf(person);
    const rooms = new Set(person.rooms);
    return calls.filter((call) => ids.has(call.userId) || rooms.has(call.roomId)).slice(0, limit);
}
