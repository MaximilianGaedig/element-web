/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";
import { isSupportedReceiptType } from "matrix-js-sdk/src/utils";

import type { IReadReceiptProps } from "../../components/views/rooms/EventTile";
import { getFunctionalMembers } from "../room/getFunctionalMembers";

/**
 * Who has read up to where, as the read receipts beside the messages show it: each receipt on the
 * message it marks, or - when that message is not drawn (a hidden event) - on the last one before it
 * that is. The same rules as the old timeline's (MessagePanel.getReadReceiptsByShownEvent): our own
 * receipt, ignored users and the room's service members (a bridge bot, whose marker rides its own
 * sends) are left out, and each list is newest first.
 *
 * @param events the room's events in timeline order, oldest first
 * @param shown the ids of the events the timeline draws
 */
export function receiptsByShownEvent(
    client: MatrixClient,
    room: Room,
    events: readonly MatrixEvent[],
    shown: ReadonlySet<string>,
): Map<string, IReadReceiptProps[]> {
    const me = client.getSafeUserId();
    const serviceMembers = new Set(getFunctionalMembers(room));
    const byEvent = new Map<string, IReadReceiptProps[]>();
    let lastShown: string | undefined;
    for (const event of events) {
        const id = event.getId();
        if (id && shown.has(id)) lastShown = id;
        if (!lastShown) continue;
        for (const r of room.getReceiptsForEvent(event)) {
            if (!r.userId || !isSupportedReceiptType(r.type) || r.userId === me) continue;
            if (client.isUserIgnored(r.userId) || serviceMembers.has(r.userId)) continue;
            const list = byEvent.get(lastShown) ?? [];
            // A user with both a public and a private receipt on the same message is still one reader.
            if (list.some((other) => other.userId === r.userId)) continue;
            list.push({ userId: r.userId, roomMember: room.getMember(r.userId), ts: r.data?.ts ?? 0 });
            byEvent.set(lastShown, list);
        }
    }
    for (const list of byEvent.values()) list.sort((a, b) => b.ts - a.ts);
    return byEvent;
}
