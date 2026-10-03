/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Whether somebody else has read one of our messages: the second tick, in its read colour.
 *
 * The old timeline worked this out for the whole list at once and passed it to each tile; the new one
 * never did, so no message there could ever show as read. It is worked out here instead, from the room,
 * so any timeline gets it: the newest event somebody other than us (and not a bridge's bot) has a read
 * receipt on, and every event up to it counts as read - a receipt means everything before it was read.
 */

import { type MatrixEvent, type Room, ReceiptType, RoomEvent } from "matrix-js-sdk/src/matrix";
import { useCallback, useSyncExternalStore } from "react";

import { getBridgeBots } from "../bridge/bridgeInfo";

/** Per room, where others have read up to, recomputed when receipts or the timeline change. */
const cache = new WeakMap<Room, { ts: number; eventId?: string }>();

/** The newest event in the live timeline that somebody else has read: its timestamp, or -1 for none. */
export function othersReadUpTo(room: Room): { ts: number; eventId?: string } {
    const held = cache.get(room);
    if (held) return held;
    const me = room.client.getSafeUserId();
    const bots = getBridgeBots(room);
    const events = room.getLiveTimeline().getEvents();
    let found: { ts: number; eventId?: string } = { ts: -1 };
    for (let i = events.length - 1; i >= 0; i--) {
        const readers = room
            .getReceiptsForEvent(events[i])
            .filter(
                (receipt) => receipt.type === ReceiptType.Read && receipt.userId !== me && !bots.has(receipt.userId),
            );
        if (readers.length) {
            found = { ts: events[i].getTs(), eventId: events[i].getId() };
            break;
        }
    }
    cache.set(room, found);
    return found;
}

/** Whether `event` is at or before what somebody else has read. */
export function isReadByOthers(room: Room, event: MatrixEvent): boolean {
    const upTo = othersReadUpTo(room);
    if (upTo.ts < 0) return false;
    return event.getId() === upTo.eventId || event.getTs() <= upTo.ts;
}

/** {@link isReadByOthers}, kept current as receipts arrive. */
export function useReadByOthers(room: Room | null | undefined, event: MatrixEvent, enabled: boolean): boolean {
    const subscribe = useCallback(
        (listener: () => void) => {
            if (!room || !enabled) return () => {};
            const changed = (): void => {
                cache.delete(room);
                listener();
            };
            room.on(RoomEvent.Receipt, changed);
            room.on(RoomEvent.Timeline, changed);
            return () => {
                room.off(RoomEvent.Receipt, changed);
                room.off(RoomEvent.Timeline, changed);
            };
        },
        [room, enabled],
    );
    const read = useCallback(() => !!room && enabled && isReadByOthers(room, event), [room, event, enabled]);
    return useSyncExternalStore(subscribe, read, read);
}

/**
 * Whether a bridge's bot has a receipt at or after `event`: the bridge got it onto its network. Bridges
 * say so this way (delivery_receipts) rather than with a status event after every message, and it is
 * never a read - see {@link othersReadUpTo}.
 */
export function isAcceptedByBridge(room: Room, event: MatrixEvent): boolean {
    const eventId = event.getId();
    if (!eventId) return false;
    for (const bot of getBridgeBots(room)) {
        if (room.hasUserReadEvent(bot, eventId)) return true;
    }
    return false;
}

/** {@link isAcceptedByBridge}, kept current as receipts arrive. */
export function useAcceptedByBridge(room: Room | null | undefined, event: MatrixEvent, enabled: boolean): boolean {
    const subscribe = useCallback(
        (listener: () => void) => {
            if (!room || !enabled) return () => {};
            room.on(RoomEvent.Receipt, listener);
            return () => {
                room.off(RoomEvent.Receipt, listener);
            };
        },
        [room, enabled],
    );
    const accepted = useCallback(() => !!room && enabled && isAcceptedByBridge(room, event), [room, event, enabled]);
    return useSyncExternalStore(subscribe, accepted, accepted);
}
