/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import {
    ClientEvent,
    EventType,
    type MatrixClient,
    type MatrixEvent,
    type Room,
    type RoomMember,
    RoomMemberEvent,
} from "matrix-js-sdk/src/matrix";

/*
 * What a typing user is doing. Other networks tell their users that a contact is recording a voice
 * message or sending a photo; `m.typing` alone only says "typing". With the `im.mxg.typing_kinds`
 * extension the kind rides beside it: in the body of the typing request, and for each typing user
 * in the content of the `m.typing` event.
 */

/** The unstable feature a server advertises when it relays typing kinds. */
export const TYPING_KINDS_FEATURE = "im.mxg.typing_kinds";
/** The field of the typing request's body that carries our own kind. */
export const TYPING_KIND_FIELD = "im.mxg.typing.kind";
/** The field of the `m.typing` content that maps each user not typing plain text to their kind. */
const TYPING_KINDS_FIELD = "im.mxg.typing.kinds";

/** Everything a typing user can be doing other than typing text. */
const TYPING_ACTIVITIES = [
    "recording_voice",
    "recording_video",
    "uploading_photo",
    "uploading_video",
    "uploading_file",
    "uploading_voice",
    "choosing_sticker",
] as const;

export type TypingActivity = (typeof TYPING_ACTIVITIES)[number];
export type TypingKind = "text" | TypingActivity;

/**
 * Reads a kind off the wire. The vocabulary is closed: anything else, including a kind a newer server
 * came up with, is plain typing rather than an error.
 */
export function parseTypingKind(value: unknown): TypingKind {
    return (TYPING_ACTIVITIES as readonly unknown[]).includes(value) ? (value as TypingActivity) : "text";
}

/**
 * The kinds in the content of an `m.typing` event: only for users the event lists as typing, and only
 * those doing something other than typing text.
 */
export function typingKindsOf(content: unknown): Map<string, TypingActivity> {
    const kinds = new Map<string, TypingActivity>();
    if (!content || typeof content !== "object") return kinds;
    const { user_ids: userIds, [TYPING_KINDS_FIELD]: raw } = content as Record<string, unknown>;
    if (!Array.isArray(userIds) || !raw || typeof raw !== "object" || Array.isArray(raw)) return kinds;
    for (const userId of userIds) {
        if (typeof userId !== "string" || !Object.hasOwn(raw, userId)) continue;
        const kind = parseTypingKind((raw as Record<string, unknown>)[userId]);
        if (kind !== "text") kinds.set(userId, kind);
    }
    return kinds;
}

/** The kind to show while a file of this MIME type uploads. */
export function uploadTypingKind(mimeType: string | undefined): TypingActivity {
    if (mimeType?.startsWith("image/")) return "uploading_photo";
    if (mimeType?.startsWith("video/")) return "uploading_video";
    if (mimeType?.startsWith("audio/")) return "uploading_voice";
    return "uploading_file";
}

interface Watched {
    /** Room ID → user ID → kind, for the rooms where somebody is doing something other than typing text. */
    kinds: Map<string, Map<string, TypingActivity>>;
    /** Room ID → the users the SDK holds as typing there. */
    typing: Map<string, Set<string>>;
    /** The typing events already attributed to a room. */
    placed: WeakSet<MatrixEvent>;
}

const watched = new WeakMap<MatrixClient, Watched>();
const listeners = new Set<(roomId: string) => void>();

function sameKinds(a: Map<string, TypingActivity> | undefined, b: Map<string, TypingActivity>): boolean {
    if ((a?.size ?? 0) !== b.size) return false;
    for (const [userId, kind] of b) {
        if (a?.get(userId) !== kind) return false;
    }
    return true;
}

function place(state: Watched, roomId: string, event: MatrixEvent): void {
    state.placed.add(event);
    const kinds = typingKindsOf(event.getContent());
    if (sameKinds(state.kinds.get(roomId), kinds)) return;
    if (kinds.size) state.kinds.set(roomId, kinds);
    else state.kinds.delete(roomId);
    for (const listener of listeners) listener(roomId);
}

/**
 * The room a typing event without a room ID belongs to, when nobody in it started or stopped typing:
 * the one room whose typing members are exactly the event's. That is how somebody going from typing
 * to recording a voice message arrives, as the list of typing users did not change.
 *
 * With the same people typing in two rooms at once there is no telling, and the kinds are left as
 * they were until one of them starts or stops.
 */
function roomOfUnchangedTyping(client: MatrixClient, state: Watched, event: MatrixEvent): string | undefined {
    const userIds: unknown = event.getContent().user_ids;
    if (!Array.isArray(userIds) || !userIds.length) return undefined;
    let found: string | undefined;
    for (const [roomId, typing] of state.typing) {
        if (!typing.size || [...typing].some((userId) => !userIds.includes(userId))) continue;
        const room = client.getRoom(roomId);
        // Users the event lists but the room does not know as members (they are not loaded yet) were
        // never marked as typing, so they do not count against the match.
        if (!room || userIds.some((userId) => !typing.has(userId) && room.getMember(userId))) continue;
        if (found !== undefined) return undefined;
        found = roomId;
    }
    return found;
}

/**
 * Starts keeping what the typing users of each room are doing, from the `m.typing` events `client`
 * receives. Safe to call again for the same client.
 *
 * The SDK only tells us that a member is typing, and its typing events from /sync carry no room ID.
 * When a member starts or stops typing the SDK hands us the event together with the member, and so
 * the room. An event that changes only what somebody is doing has to be matched to its room, see
 * {@link roomOfUnchangedTyping}.
 */
export function watchTypingKinds(client: MatrixClient): void {
    if (watched.has(client)) return;
    const state: Watched = { kinds: new Map(), typing: new Map(), placed: new WeakSet() };
    watched.set(client, state);

    client.on(RoomMemberEvent.Typing, (event: MatrixEvent, member: RoomMember) => {
        let typing = state.typing.get(member.roomId);
        if (member.typing) {
            if (!typing) state.typing.set(member.roomId, (typing = new Set()));
            typing.add(member.userId);
        } else {
            typing?.delete(member.userId);
            if (typing && !typing.size) state.typing.delete(member.roomId);
        }
        if (!state.placed.has(event)) place(state, member.roomId, event);
    });

    client.on(ClientEvent.Event, (event: MatrixEvent) => {
        if (event.getType() !== EventType.Typing || state.placed.has(event)) return;
        const roomId = event.getRoomId() ?? roomOfUnchangedTyping(client, state, event);
        if (roomId) place(state, roomId, event);
    });
}

/** What `userId` is doing in `room`, which is typing text unless the last typing event said otherwise. */
export function typingKindOf(room: Room, userId: string): TypingKind {
    return watched.get(room.client)?.kinds.get(room.roomId)?.get(userId) ?? "text";
}

/**
 * Calls `listener` with the room ID whenever what somebody in a room is doing changed, which can
 * happen without anybody starting or stopping to type. Returns the function that stops it.
 */
export function onTypingKindsChanged(listener: (roomId: string) => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
