/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * What a bridged chat's details can say about its history: whether all of it has been imported from the
 * other network (the bridge records that in the room, `im.mxg.backfill`), and the room's message
 * counts (the homeserver's `im.mxg.room_stats`).
 */

import { Method, type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

export const BACKFILL_EVENT_TYPE = "im.mxg.backfill";

/**
 * complete: the network said there is nothing older; running: older history is being imported;
 * manual: importing more needs a request; unavailable: the network offers no older history.
 */
export type BackfillState = "complete" | "running" | "manual" | "unavailable" | "skipped";

export interface BackfillStatus {
    state: BackfillState;
    /** Messages of this chat the bridge has imported. */
    bridged_messages: number;
    /** Times of the oldest and newest imported message (milliseconds). */
    oldest_ts?: number;
    newest_ts?: number;
    /** How many the network says the chat has, when it can say. */
    remote_total?: number;
    batches: number;
    /** The chat was being imported when this was written (not just waiting its turn). */
    active?: boolean;
    /** Messages imported per minute, as the bridge measured it. */
    rate_per_min?: number;
    /** For a chat waiting its turn: chats in front of it, and chats waiting in all. */
    queue_ahead?: number;
    queue_size?: number;
    /** What to send in the room to ask for the rest: "<prefix> backfill". */
    command_prefix: string;
    network: string;
    updated_ts: number;
}

const STATES: BackfillState[] = ["complete", "running", "manual", "unavailable", "skipped"];

/** The bridge's record of how much of the room's history it has imported, if the room has one. */
export function backfillStatusOf(room: Room): BackfillStatus | undefined {
    const content = room.currentState.getStateEvents(BACKFILL_EVENT_TYPE, "")?.getContent<Partial<BackfillStatus>>();
    if (!content || !STATES.includes(content.state as BackfillState)) return undefined;
    return {
        state: content.state as BackfillState,
        bridged_messages: Number(content.bridged_messages) || 0,
        oldest_ts: content.oldest_ts,
        newest_ts: content.newest_ts,
        remote_total: content.remote_total,
        batches: Number(content.batches) || 0,
        active: !!content.active,
        rate_per_min: content.rate_per_min,
        queue_ahead: content.queue_ahead,
        queue_size: content.queue_size,
        command_prefix: content.command_prefix ?? "",
        network: content.network ?? "",
        updated_ts: Number(content.updated_ts) || 0,
    };
}

/** Asks the bridge not to import this chat's older history (it can be asked for again). */
export async function requestSkipBackfill(room: Room, status: BackfillStatus): Promise<void> {
    if (!status.command_prefix) return;
    await room.client.sendTextMessage(room.roomId, `${status.command_prefix} backfill skip`);
}

/** Asks the bridge to import the rest of the chat's history. */
export async function requestFullBackfill(room: Room, status: BackfillStatus): Promise<void> {
    if (!status.command_prefix) return;
    await room.client.sendTextMessage(room.roomId, `${status.command_prefix} backfill`);
}

export interface RoomStats {
    /** What the chat takes up on the server, in bytes. */
    storage?: { events: number; media_stored: number; media_on_demand: number };
    total: number;
    by_kind: Record<string, number>;
    senders: Array<{ user_id: string; total: number; by_kind: Record<string, number> }>;
    sender_count: number;
    first_ts?: number;
    last_ts?: number;
    /** False until the server's counters have covered the whole history. */
    complete: boolean;
    /** Messages per calendar month (`2024-03`), oldest first. */
    by_month?: Array<{ month: string; count: number }>;
    /** Messages per hour of the week in UTC, Monday 00:00 first (168 entries). */
    by_hour_of_week?: number[];
}

/** The 168 hours of the week shifted from UTC to the reader's time zone (whole hours), Monday 00:00 first. */
export function hourOfWeekLocal(utc: number[], offsetMinutes = -new Date().getTimezoneOffset()): number[] {
    const shift = Math.round(offsetMinutes / 60);
    const local = new Array<number>(168).fill(0);
    for (let i = 0; i < 168; i++) local[(((i + shift) % 168) + 168) % 168] = utc[i] ?? 0;
    return local;
}

/** Messages per weekday (Monday first) and per hour of the day, from the week's 168 hours. */
export function weekdayAndHour(hours: number[]): { weekdays: number[]; hoursOfDay: number[] } {
    const weekdays = new Array<number>(7).fill(0);
    const hoursOfDay = new Array<number>(24).fill(0);
    hours.forEach((count, i) => {
        weekdays[Math.floor(i / 24)] += count;
        hoursOfDay[i % 24] += count;
    });
    return { weekdays, hoursOfDay };
}

/** Months as calendar years: how many messages each year had. */
export function perYear(months: Array<{ month: string; count: number }>): Array<{ year: string; count: number }> {
    const years = new Map<string, number>();
    for (const { month, count } of months) years.set(month.slice(0, 4), (years.get(month.slice(0, 4)) ?? 0) + count);
    return [...years.entries()].map(([year, count]) => ({ year, count }));
}

const STATS_FEATURE = "im.mxg.room_stats";
const STATS_PREFIX = "/_matrix/client/unstable/im.mxg.stats";
/** Counts change with every message, but not so fast that opening the panel twice needs two requests. */
const STATS_TTL_MS = 60_000;
const cache = new Map<string, { at: number; stats: Promise<RoomStats | undefined> }>();

/** The room's message counts, or undefined if the homeserver doesn't keep them. */
export function fetchRoomStats(client: MatrixClient, roomId: string): Promise<RoomStats | undefined> {
    const hit = cache.get(roomId);
    if (hit && Date.now() - hit.at < STATS_TTL_MS) return hit.stats;
    const stats = (async (): Promise<RoomStats | undefined> => {
        try {
            if (!(await client.doesServerSupportUnstableFeature(STATS_FEATURE))) return undefined;
            return await client.http.authedRequest<RoomStats>(
                Method.Get,
                `${STATS_PREFIX}/rooms/${encodeURIComponent(roomId)}`,
                { senders: "20" },
                undefined,
                { prefix: "" },
            );
        } catch (e) {
            logger.warn("Could not load the room's statistics", e);
            cache.delete(roomId);
            return undefined;
        }
    })();
    cache.set(roomId, { at: Date.now(), stats });
    return stats;
}

/**
 * What to show for a chat's history: importing (a batch came in lately), queued (waiting its turn, or
 * the bridge went quiet), paused (needs a request), complete, or unavailable from the network.
 */
export type HistoryPhase = "importing" | "queued" | "paused" | "complete" | "unavailable" | "skipped";

/** A running import that hasn't reported for this long is not being worked on right now. */
export const IMPORT_STALE_MS = 3 * 60_000;

export function historyPhase(status: BackfillStatus, now = Date.now()): HistoryPhase {
    switch (status.state) {
        case "complete":
            return "complete";
        case "unavailable":
            return "unavailable";
        case "skipped":
            return "skipped";
        case "manual":
            return "paused";
        default:
            return status.active && now - status.updated_ts < IMPORT_STALE_MS ? "importing" : "queued";
    }
}

export interface ImportProgress {
    /** Messages imported per minute, from how the count moved while this page was watching. */
    perMinute?: number;
    /** 0..1 when the network says how many messages the chat has. */
    fraction?: number;
    /** Messages still to import, when the network says how many the chat has. */
    left?: number;
    /** Milliseconds left at the current pace, when both are known. */
    etaMs?: number;
}

/** What the watcher saw of each room's import: when, and how many messages were imported by then. */
const samples = new Map<string, Array<{ at: number; count: number }>>();
const SAMPLE_WINDOW_MS = 15 * 60_000;
/** Below this the pace is noise, not a rate. */
const MIN_SPAN_MS = 20_000;

/** Records the bridge's latest count for a room and works out pace, progress and time left. */
export function trackImport(roomId: string, status: BackfillStatus, now = Date.now()): ImportProgress {
    const list = (samples.get(roomId) ?? []).filter((s) => now - s.at <= SAMPLE_WINDOW_MS);
    const last = list[list.length - 1];
    if (!last || last.count !== status.bridged_messages) list.push({ at: now, count: status.bridged_messages });
    samples.set(roomId, list);

    const first = list[0];
    const newest = list[list.length - 1];
    const span = newest.at - first.at;
    let perMinute: number | undefined = status.rate_per_min || undefined;
    if (!perMinute && span >= MIN_SPAN_MS && newest.count > first.count) {
        perMinute = ((newest.count - first.count) / span) * 60_000;
    }

    let fraction: number | undefined;
    let etaMs: number | undefined;
    let leftCount: number | undefined;
    if (status.remote_total && status.remote_total > 0) {
        fraction = Math.min(1, status.bridged_messages / status.remote_total);
        const left = Math.max(0, status.remote_total - status.bridged_messages);
        leftCount = left;
        if (perMinute) etaMs = (left / perMinute) * 60_000;
    }
    return { perMinute, fraction, etaMs, left: leftCount };
}
