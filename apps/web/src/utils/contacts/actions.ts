/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Going somewhere from a person: their chat, a call with them, a place in a chat. Shared by the contacts
 * list and by a person's card wherever it is shown, so either reaches the same chat the same way.
 */

import { type MatrixClient } from "matrix-js-sdk/src/matrix";
import { CallType } from "matrix-js-sdk/src/webrtc/call";

import dis from "../../dispatcher/dispatcher";
import { Action } from "../../dispatcher/actions";
import { type ViewRoomPayload } from "../../dispatcher/payloads/ViewRoomPayload";
import { SDKContextClass } from "../../contexts/SDKContextClass";
import { DirectoryMember, startDmOnFirstMessage } from "../direct-messages";
import { type Person } from "./people";

/** Somewhere to go: a room, at a particular event when one is named. */
export function openRoom(roomId: string, eventId?: string): void {
    dis.dispatch<ViewRoomPayload>({
        action: Action.ViewRoom,
        room_id: roomId,
        ...(eventId ? { event_id: eventId, highlighted: true } : {}),
        metricsTrigger: undefined,
    });
}

/**
 * A chat with them, on the account asked for or on whichever one can: an existing chat is opened, and
 * without one a DM is started on the first message.
 */
export function messagePerson(client: MatrixClient, person: Person, mxid?: string): void {
    const wanted = mxid ? person.accounts.find((one) => one.mxid === mxid) : undefined;
    const existing = wanted?.roomId ?? person.rooms[0];
    if (existing) {
        openRoom(existing);
        return;
    }
    const account = wanted ?? person.accounts.find((one) => one.mxid);
    if (!account?.mxid) return;
    void startDmOnFirstMessage(client, [
        new DirectoryMember({
            user_id: account.mxid,
            display_name: account.name,
            avatar_url: account.avatarUrl,
        }),
    ]);
}

/**
 * Place a call in the chat the reader picked.
 *
 * Viewed first, then placed: a call belongs to a room, and the room has to be the one on screen for the
 * call UI to have anywhere to live. Which network it goes over is decided by which chat this is - that
 * chat's bridge carries it - so the choice was already made where the chat was picked.
 */
export function callInRoom(roomId: string, video: boolean): void {
    openRoom(roomId);
    // Forced through Matrix calling, as the room header does for a bridged DM: those rooms carry the
    // bridge bot as a third member, which the handler counting members cannot tell from a group.
    void SDKContextClass.instance.legacyCallHandler.placeCall(
        roomId,
        video ? CallType.Video : CallType.Voice,
        undefined,
        true,
    );
}
