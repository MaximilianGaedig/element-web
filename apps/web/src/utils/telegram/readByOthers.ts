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
 *
 * The chat list asks too, for rooms nobody has open, so the cache drops itself on the room's own events
 * rather than relying on a timeline's hook to do it.
 */

import { type MatrixEvent, type Room, ReceiptType, RoomEvent } from "matrix-js-sdk/src/matrix";
import { useCallback, useSyncExternalStore } from "react";

import { getBridgeBots } from "../bridge/bridgeInfo";
import { getFunctionalMembers } from "../room/getFunctionalMembers";

/** Per room, where others have read up to in timeline order, recomputed when receipts or the timeline change. */
const cache = new WeakMap<Room, number>();
/** Rooms whose events already drop their cache entry. */
const watched = new WeakSet<Room>();

/**
 * Drop the room's cache entry whenever a receipt or the live timeline changes. Prepended, so it runs
 * before any other listener of the room that reads the answer back in response to the same event.
 */
function watch(room: Room): void {
    if (watched.has(room) || typeof room.prependListener !== "function") return;
    watched.add(room);
    const drop = (): void => {
        cache.delete(room);
    };
    room.prependListener(RoomEvent.Receipt, drop);
    room.prependListener(RoomEvent.Timeline, drop);
    room.prependListener(RoomEvent.TimelineReset, drop);
}

/**
 * Whose receipts say nothing about the other side having read: us, the bridges' bots, and the room's
 * service members (`io.element.functional_members`: the bot again, and the ghosts of our own accounts).
 * A bot's receipt at most says the network accepted the message, which is the single tick already.
 */
function ignoredReaders(room: Room): Set<string> {
    const ignored = getBridgeBots(room);
    for (const userId of getFunctionalMembers(room)) ignored.add(userId);
    ignored.add(room.client.getSafeUserId());
    return ignored;
}

/** The newest event in the live timeline that somebody else has read: its position, or -1 for none. */
export function othersReadUpTo(room: Room): number {
    const held = cache.get(room);
    if (held) return held;
    watch(room);
    const ignored = ignoredReaders(room);
    const events = room.getLiveTimeline().getEvents();
    let found = -1;
    for (let i = events.length - 1; i >= 0; i--) {
        const readers = room
            .getReceiptsForEvent(events[i])
            .filter((receipt) => receipt.type === ReceiptType.Read && !ignored.has(receipt.userId));
        if (readers.length) {
            found = i;
            break;
        }
    }
    cache.set(room, found);
    return found;
}

/** Whether `event` is at or before what somebody else has read. */
export function isReadByOthers(room: Room, event: MatrixEvent): boolean {
    const upTo = othersReadUpTo(room);
    if (upTo < 0) return false;
    const eventId = event.getId();
    if (!eventId) return false;
    const eventIndex = room
        .getLiveTimeline()
        .getEvents()
        .findIndex((timelineEvent) => timelineEvent.getId() === eventId);
    return eventIndex >= 0 && eventIndex <= upTo;
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
