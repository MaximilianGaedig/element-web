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
import { isReadByOthers } from "./readByOthers";
import { failedSendsFor } from "../room/failedSends";
import { MessageSendStatusStore } from "../bridge/messageSendStatus";
import { getBridgeBots } from "../bridge/bridgeInfo";
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
    return getTelegramSendState({ ...input, bridgeDown: health === "disconnected" || health === "problem" });
}
