/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The ticks on a chat list row: Telegram shows the delivery state of the chat's last message next to its
 * name when that message is yours. Worked out the same way as the ticks on the message itself in the
 * timeline (TelegramTimeSlot), so the row and the bubble never disagree.
 */

import { type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";

import { getTelegramSendState, type TelegramSendState } from "./telegramTime";
import { isAcceptedByBridge, isReadByOthers } from "./readByOthers";
import { failedSendsFor } from "../room/failedSends";
import { MessageSendStatusStore } from "../bridge/messageSendStatus";
import { getBridgeBots } from "../bridge/bridgeInfo";
import { getFunctionalMembers } from "../room/getFunctionalMembers";
import { bridgeHealthOf } from "../bridgeLogins";

/** The delivery state of `event` when we sent it, or undefined for anyone else's message. */
export function getPreviewSendState(
    client: MatrixClient,
    room: Room,
    event: MatrixEvent | undefined,
): TelegramSendState | undefined {
    if (!event || event.getSender() !== client.getUserId()) return undefined;
    // Anything of ours about the message that failed - the message itself, an edit of it, its deletion.
    if (failedSendsFor(event, room).length > 0) return "error";
    const eventId = event.getId();
    const bridgeStatus = eventId ? MessageSendStatusStore.forClient(client).get(eventId, room.roomId) : undefined;
    const input = {
        eventSendStatus: event.status,
        bridgeStatus: bridgeStatus?.status,
        bridgeDelivered: !!bridgeStatus?.delivered_to_users?.length,
        readByOthers: isReadByOthers(room, event),
    };
    const state = getTelegramSendState(input);
    /*
     * Whether the bridge is down only matters for a message it said nothing about, and finding out reads
     * every joined room's bridge login, so it is only asked then - and only of a bridged room.
     */
    if (state !== "sent" || bridgeStatus || getBridgeBots(room).size === 0) return state;
    const health = bridgeHealthOf(client, room);
    return getTelegramSendState({
        ...input,
        bridgeDown: health === "disconnected" || health === "problem",
        // Bridges say a message reached their network with their bot's receipt, not a status.
        bridgeAccepted: isAcceptedByBridge(room, event),
    });
}

/** How many readers' avatars a chat list line shows, newest first. */
const MAX_PREVIEW_READERS = 3;

/**
 * In a group, who has read `event` when it is ours and some but not all of the others have: their user IDs,
 * newest first. Shown on the chat list line instead of the ticks until everyone has read it, when the ticks
 * say "read" again; nobody yet, or a chat with one other person, keeps the ticks. Bridge bots and a room's
 * service members are not readers, as nowhere else.
 */
export function getPreviewReaders(
    client: MatrixClient,
    room: Room,
    event: MatrixEvent | undefined,
): string[] | undefined {
    const me = client.getUserId();
    if (!event || event.getSender() !== me) return undefined;
    const notPeople = new Set([...getBridgeBots(room), ...getFunctionalMembers(room)]);
    const others = room.getJoinedMembers().filter((member) => member.userId !== me && !notPeople.has(member.userId));
    if (others.length < 2) return undefined;
    const readers = room
        .getUsersReadUpTo(event)
        .filter((userId) => userId !== me && !notPeople.has(userId) && !client.isUserIgnored(userId));
    if (readers.length === 0 || readers.length >= others.length) return undefined;
    const readAt = (userId: string): number => room.getReadReceiptForUserId(userId)?.data?.ts ?? 0;
    return readers.sort((a, b) => readAt(b) - readAt(a)).slice(0, MAX_PREVIEW_READERS);
}
