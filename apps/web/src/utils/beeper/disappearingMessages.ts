/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type MatrixEvent, type Room, ReceiptType } from "matrix-js-sdk/src/matrix";

/**
 * Both the room state event type (state_key "") holding the chat's current timer and the content
 * key bridges put on each message that will disappear.
 */
export const DISAPPEARING_TIMER_KEY = "com.beeper.disappearing_timer";

export type DisappearingType = "after_read" | "after_read_by_recipient" | "after_send";

export interface DisappearingTimer {
    type: DisappearingType;
    /** Milliseconds. */
    timer: number;
}

const TYPES: DisappearingType[] = ["after_read", "after_read_by_recipient", "after_send"];

/** Parses a timer object; an empty object (or a zero timer) means "disabled". */
export function parseDisappearingTimer(raw: unknown): DisappearingTimer | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    const { type, timer } = raw as Record<string, unknown>;
    if (!TYPES.includes(type as DisappearingType) || typeof timer !== "number" || timer <= 0) return undefined;
    return { type: type as DisappearingType, timer };
}

/** The room's current disappearing-messages setting, if enabled. */
export function getRoomDisappearingTimer(room: Room): DisappearingTimer | undefined {
    const ev = room.currentState.getStateEvents(DISAPPEARING_TIMER_KEY, "");
    return parseDisappearingTimer(ev?.getContent());
}

/** The timer a given message was sent with, if it will disappear. */
export function getEventDisappearingTimer(mxEvent: MatrixEvent): DisappearingTimer | undefined {
    if (mxEvent.isState() || mxEvent.isRedacted()) return undefined;
    return parseDisappearingTimer(mxEvent.getOriginalContent()?.[DISAPPEARING_TIMER_KEY]);
}

/**
 * When the timer of a message started, or undefined if it hasn't started (yet) as far as we can tell.
 *
 * - after_send: when it was sent.
 * - after_read(_by_recipient) on someone else's message: when our read receipt covering it was sent.
 * - after_read on our own message: when another member's receipt covering it was sent; the bridge
 *   reports remote reads as read receipts from the puppets.
 */
export function getDisappearingStart(mxEvent: MatrixEvent, room: Room | null, myUserId: string): number | undefined {
    const timer = getEventDisappearingTimer(mxEvent);
    if (!timer) return undefined;
    if (timer.type === "after_send") return mxEvent.getTs();
    if (!room) return undefined;
    const eventId = mxEvent.getId();
    if (!eventId) return undefined;

    const readTs = (userId: string): number | undefined => {
        if (!room.hasUserReadEvent(userId, eventId)) return undefined;
        const receipt =
            room.getReadReceiptForUserId(userId, false, ReceiptType.Read) ??
            room.getReadReceiptForUserId(userId, false, ReceiptType.ReadPrivate);
        // A receipt older than the event must be implicit (they sent a later message); use the send time.
        return Math.max(receipt?.data.ts ?? 0, mxEvent.getTs());
    };

    if (mxEvent.getSender() !== myUserId) return readTs(myUserId);
    const starts = room
        .getJoinedMembers()
        .filter((m) => m.userId !== myUserId)
        .map((m) => readTs(m.userId))
        .filter((ts): ts is number => ts !== undefined);
    return starts.length ? Math.min(...starts) : undefined;
}

/** Epoch ms at which the message disappears, or undefined if its timer hasn't started. */
export function getDisappearingExpiry(mxEvent: MatrixEvent, room: Room | null, myUserId: string): number | undefined {
    const timer = getEventDisappearingTimer(mxEvent);
    const start = getDisappearingStart(mxEvent, room, myUserId);
    return timer && start !== undefined ? start + timer.timer : undefined;
}

/** True once a disappearing message's timer has run out (the bridge redacts it shortly after). */
export function hasDisappeared(mxEvent: MatrixEvent, room: Room | null, myUserId: string, now = Date.now()): boolean {
    const expiry = getDisappearingExpiry(mxEvent, room, myUserId);
    return expiry !== undefined && expiry <= now;
}

/** Compact duration like "30s", "5m", "8h", "7d", "4w". */
export function formatDisappearingDuration(ms: number): string {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.round(h / 24);
    if (d < 7 || d % 7 !== 0) return `${d}d`;
    return `${d / 7}w`;
}
