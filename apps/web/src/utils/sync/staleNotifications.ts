/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * MEO-105: a browser notification came up on a reload for a message nearly a year old. A "live" event is
 * one the sync says just happened, and nothing that old just happened, so a notification for it is wrong
 * however it got marked live. This module is the second line of defence (the Notifier skips such events)
 * and the instrument: each skip is kept, with what sliding sync last said about that room, so the cause
 * can be read from the record instead of guessed. Read it with `mxStaleNotifications()` in the console.
 */

import { type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { type MSC3575RoomData } from "matrix-js-sdk/src/sliding-sync";
import { logger } from "matrix-js-sdk/src/logger";

/** An event sent longer ago than this does not notify: it is history that was delivered late, not news. */
export const STALE_NOTIFICATION_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const STORAGE_KEY = "mx_stale_notifications";
const MAX_RECORDS = 20;

/** What sliding sync last said about a room: enough to tell whether it called an old event live. */
export interface RoomDataSummary {
    receivedAt: number;
    initial?: boolean;
    limited?: boolean;
    numLive?: number;
    timeline: number;
    /** The newest events of the timeline as `id@timestamp`, oldest first. */
    tail: string[];
}

export interface StaleNotificationRecord {
    at: number;
    roomId?: string;
    eventId?: string;
    eventTs: number;
    ageDays: number;
    syncState?: string;
    roomData?: RoomDataSummary;
}

const roomData = new Map<string, RoomDataSummary>();

/** Called for every room the server describes. */
export function noteRoomData(roomId: string, data: MSC3575RoomData, now = Date.now()): void {
    const timeline = data.timeline ?? [];
    roomData.set(roomId, {
        receivedAt: now,
        initial: data.initial,
        limited: data.limited,
        numLive: data.num_live,
        timeline: timeline.length,
        tail: timeline.slice(-5).map((event) => `${event.event_id}@${event.origin_server_ts}`),
    });
}

/** Whether the event is too old for a notification. An event with no timestamp is not judged. */
export function isStaleForNotification(event: MatrixEvent, now = Date.now()): boolean {
    const ts = event.getTs();
    return typeof ts === "number" && ts > 0 && now - ts > STALE_NOTIFICATION_AGE_MS;
}

export function readStaleNotifications(): StaleNotificationRecord[] {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as StaleNotificationRecord[];
    } catch {
        return [];
    }
}

/** Keeps a skipped notification, across reloads, with what the sync said about its room. */
export function recordStaleNotification(event: MatrixEvent, syncState?: string, now = Date.now()): void {
    const roomId = event.getRoomId();
    const record: StaleNotificationRecord = {
        at: now,
        roomId,
        eventId: event.getId(),
        eventTs: event.getTs(),
        ageDays: Math.round((now - event.getTs()) / 86_400_000),
        syncState,
        roomData: roomId ? roomData.get(roomId) : undefined,
    };
    logger.warn("Not notifying for an event sent long ago", record);
    try {
        const records = [...readStaleNotifications(), record].slice(-MAX_RECORDS);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    } catch {
        // storage unavailable or full: the warning above is all there is
    }
}

(window as unknown as { mxStaleNotifications?: () => StaleNotificationRecord[] }).mxStaleNotifications =
    readStaleNotifications;
