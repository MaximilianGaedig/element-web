/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * What is waiting for you, across every chat at once.
 *
 * Opening forty unread chats to find the two that need answering is the thing a machine should be doing,
 * and it is the one use of a model here that is worth its cost every single day. So: the unread messages
 * of every chat that has any, each labelled with the chat it came from, asked for in one request, and
 * answered as a line per chat with whether it is waiting on you.
 *
 * What it is *not* is automatic. Nothing is sent anywhere until the digest is asked for, because "your
 * whole unread pile, every morning, without being asked" is a different product with different consent.
 */

import { type MatrixClient, type Room, type MatrixEvent } from "matrix-js-sdk/src/matrix";

import { type AskMessage } from "./ask";
import { sayable } from "./readable";

/** Chats worth asking about, and how much of each is worth sending. */
const MAX_CHATS = 12;
const MAX_PER_CHAT = 25;
const MAX_MESSAGES = 150;

/** One chat with something unread in it, and what it is. */
export interface UnreadChat {
    room: Room;
    unread: MatrixEvent[];
}

/** The messages after the last one read, which is what "unread" means here. */
function unreadIn(room: Room, userId: string): MatrixEvent[] {
    const events = room.getLiveTimeline().getEvents();
    const readUpTo = room.getEventReadUpTo(userId, true);
    const at = readUpTo ? events.findIndex((event) => event.getId() === readUpTo) : -1;
    const after = at >= 0 ? events.slice(at + 1) : events;
    return after.filter((event) => event.getType() === "m.room.message" && !event.isRedacted());
}

/**
 * The chats with something unread, busiest first.
 *
 * Only what the client already holds: this is a reading of the rooms in hand, not a crawl of the server.
 */
export function unreadChats(client: MatrixClient): UnreadChat[] {
    const me = client.getSafeUserId();
    const chats: UnreadChat[] = [];
    for (const room of client.getVisibleRooms()) {
        if (room.getMyMembership() !== "join") continue;
        if (room.getUnreadNotificationCount() === 0 && !room.hasThreadUnreadNotification?.()) continue;
        const unread = unreadIn(room, me);
        if (unread.length) chats.push({ room, unread });
    }
    return chats.sort((a, b) => b.unread.length - a.unread.length).slice(0, MAX_CHATS);
}

/**
 * The pile as the model is given it: every unread message, labelled with its chat.
 *
 * The id carried is the event's own, so the answer can cite a message and the reader can be taken to it;
 * the sender carries the chat's name, because a line saying "Alice asked about the hotel" is only useful
 * if you can see which conversation it was in. A picture arrives as what it says, where anybody has read
 * it (utils/ai/readable.ts): a morning of screenshots is not a morning of nothing.
 */
export async function digestMessages(client: MatrixClient, chats: UnreadChat[]): Promise<AskMessage[]> {
    const share = Math.max(3, Math.floor(MAX_MESSAGES / Math.max(1, chats.length)));
    const taken = chats.flatMap(({ room, unread }) =>
        unread.slice(-Math.min(share, MAX_PER_CHAT)).map((event) => ({ room, event })),
    );
    const lines = await Promise.all(taken.map(({ event }) => sayable(client, event)));
    const out: AskMessage[] = [];
    for (const [at, { room, event }] of taken.entries()) {
        const body = lines[at];
        if (!body) continue;
        out.push({
            id: event.getId()!,
            sender: `${room.name} / ${event.sender?.name ?? event.getSender() ?? "?"}`,
            senderId: event.getSender(),
            avatar: event.sender?.getMxcAvatarUrl(),
            mine: event.getSender() === client.getSafeUserId(),
            ts: new Date(event.getTs()).toISOString().slice(0, 16).replace("T", " "),
            body: body.slice(0, 600),
        });
    }
    return out;
}
