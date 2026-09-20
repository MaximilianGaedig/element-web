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
export type BackfillState = "complete" | "running" | "manual" | "unavailable";

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
    /** What to send in the room to ask for the rest: "<prefix> backfill". */
    command_prefix: string;
    network: string;
    updated_ts: number;
}

const STATES: BackfillState[] = ["complete", "running", "manual", "unavailable"];

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
        command_prefix: content.command_prefix ?? "",
        network: content.network ?? "",
        updated_ts: Number(content.updated_ts) || 0,
    };
}

/** Asks the bridge to import the rest of the chat's history. */
export async function requestFullBackfill(room: Room, status: BackfillStatus): Promise<void> {
    if (!status.command_prefix) return;
    await room.client.sendTextMessage(room.roomId, `${status.command_prefix} backfill`);
}

export interface RoomStats {
    total: number;
    by_kind: Record<string, number>;
    senders: Array<{ user_id: string; total: number; by_kind: Record<string, number> }>;
    sender_count: number;
    first_ts?: number;
    last_ts?: number;
    /** False until the server's counters have covered the whole history. */
    complete: boolean;
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
