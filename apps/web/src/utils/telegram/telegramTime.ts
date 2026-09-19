/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Telegram-style in-bubble time and delivery ticks. Ported from Telegram Web K (GPL-3.0,
 * https://github.com/morethanwords/tweb): src/components/chat/messageRender.ts (MessageRender.setTime)
 * and src/components/chat/bubbles.ts (setBubbleSendingStatus).
 */

import { EventStatus, EventType, type MatrixEvent, MsgType } from "matrix-js-sdk/src/matrix";

/**
 * The delivery state tweb shows next to the time of an outgoing message
 * (bubbles.ts setBubbleSendingStatus: 'sending' | 'error' | 'sent' | 'read').
 * Telegram has no separate "delivered" state; bridges report one (com.beeper.message_send_status),
 * and it is drawn with tweb's double tick like "read".
 */
export type TelegramSendState = "sending" | "error" | "sent" | "delivered" | "read";

export interface TelegramSendStateInput {
    /** Local-echo status of the event (undefined once the server has it). */
    eventSendStatus?: EventStatus | null;
    /** The bridge's com.beeper.message_send_status for the event, if any. */
    bridgeStatus?: "SUCCESS" | "PENDING" | "FAIL_RETRIABLE" | "FAIL_PERMANENT";
    /** Whether the bridge reported the message as delivered to someone (delivered_to_users). */
    bridgeDelivered?: boolean;
    /** Whether anyone other than us has a read receipt at or after this event. */
    readByOthers?: boolean;
}

/** Maps Matrix/bridge state to tweb's sending status. */
export function getTelegramSendState({
    eventSendStatus,
    bridgeStatus,
    bridgeDelivered,
    readByOthers,
}: TelegramSendStateInput): TelegramSendState {
    if (eventSendStatus === EventStatus.NOT_SENT || eventSendStatus === EventStatus.CANCELLED) return "error";
    if (eventSendStatus && eventSendStatus !== EventStatus.SENT) return "sending";
    if (bridgeStatus === "FAIL_PERMANENT" || bridgeStatus === "FAIL_RETRIABLE") return "error";
    if (readByOthers) return "read";
    if (bridgeStatus === "PENDING") return "sending";
    if (bridgeStatus === "SUCCESS" || bridgeDelivered) return "delivered";
    return "sent";
}

/** Where the time goes: in the text flow (tweb .time) or floating over media (tweb .time.is-floating). */
export type TelegramTimePlacement = "inline" | "floating";

/** Whether an m.image/m.video/m.file/m.audio event carries a caption (MSC2530), as MessageEvent decides. */
export function hasMediaCaption(mxEvent: MatrixEvent): boolean {
    const content = mxEvent.getContent();
    return (
        [MsgType.Image, MsgType.File, MsgType.Audio, MsgType.Video].includes(content.msgtype as MsgType) &&
        !!content.filename &&
        content.filename !== content.body
    );
}

/**
 * tweb floats the time over the media when a bubble is just media (bubble.just-media / .sticker)
 * and otherwise puts it at the end of the text. Big-emoji text (.emoji-big) is handled in CSS.
 */
export function getTelegramTimePlacement(mxEvent: MatrixEvent): TelegramTimePlacement {
    if (mxEvent.getType() === EventType.Sticker) return "floating";
    if (mxEvent.getType() !== EventType.RoomMessage) return "inline";
    const msgtype = mxEvent.getContent().msgtype;
    if ((msgtype === MsgType.Image || msgtype === MsgType.Video) && !hasMediaCaption(mxEvent)) return "floating";
    return "inline";
}

/** How our messages show that others have read them (setting "readReceiptsStyle"). */
export type ReadReceiptsStyle = "avatars" | "ticks";

/**
 * The shown events, in timeline order, that someone other than us has read: everything up to the
 * newest event carrying someone's read receipt (tweb: a message is read once the peer's read
 * outbox max id reaches it, bubbles.ts updateUnreadByDialog `readOutboxMaxId`). Receipts from `ignoredUserIds` (bridge bots,
 * which may acknowledge delivery with a receipt) don't count.
 */
export function getEventIdsReadByOthers(
    eventIds: string[],
    receiptsByEvent: Map<string, { userId: string }[]>,
    ignoredUserIds: Set<string> = new Set(),
): Set<string> {
    let last = -1;
    for (let i = eventIds.length - 1; i >= 0; i--) {
        if (receiptsByEvent.get(eventIds[i])?.some((r) => !ignoredUserIds.has(r.userId))) {
            last = i;
            break;
        }
    }
    return new Set(eventIds.slice(0, last + 1));
}
