/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Every bridged chat's import state, added up: how many chats are done, how many messages of how many,
 * what is importing now and what waits in the queue, and how long the rest should take. All of it comes
 * from the `im.mxg.backfill` state each bridge keeps in each chat, so it follows the bridges live.
 */

import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";

import { type BackfillStatus, backfillStatusOf, type HistoryPhase, historyPhase } from "./chatHistory";

export interface ImportEntry {
    room: Room;
    status: BackfillStatus;
    phase: HistoryPhase;
}

export interface ImportSummary {
    chats: number;
    /** Counts by phase. */
    byPhase: Record<HistoryPhase, number>;
    /** Messages imported so far. */
    messages: number;
    /** Of the chats where the network says how many messages there are: how many, and their two totals. */
    countedChats: number;
    countedImported: number;
    countedTotal: number;
    /** Messages imported per minute across chats being imported now. */
    ratePerMinute: number;
    /** Time left for the chats whose totals are known, at the current pace. */
    etaMs?: number;
}

export interface NetworkSummary extends ImportSummary {
    network: string;
    entries: ImportEntry[];
}

export interface ImportOverview extends ImportSummary {
    entries: ImportEntry[];
    networks: NetworkSummary[];
}

const PHASES: HistoryPhase[] = ["importing", "queued", "paused", "complete", "unavailable", "skipped"];

function emptySummary(): ImportSummary {
    return {
        chats: 0,
        byPhase: Object.fromEntries(PHASES.map((p) => [p, 0])) as Record<HistoryPhase, number>,
        messages: 0,
        countedChats: 0,
        countedImported: 0,
        countedTotal: 0,
        ratePerMinute: 0,
    };
}

function add(summary: ImportSummary, entry: ImportEntry): void {
    summary.chats++;
    summary.byPhase[entry.phase]++;
    summary.messages += entry.status.bridged_messages;
    if (entry.status.remote_total) {
        summary.countedChats++;
        summary.countedImported += Math.min(entry.status.bridged_messages, entry.status.remote_total);
        summary.countedTotal += entry.status.remote_total;
    }
    if (entry.phase === "importing" && entry.status.rate_per_min) summary.ratePerMinute += entry.status.rate_per_min;
}

function finish(summary: ImportSummary, entries: ImportEntry[]): void {
    const left = entries
        .filter((e) => e.phase !== "complete" && e.phase !== "skipped" && e.phase !== "unavailable")
        .reduce((sum, e) => sum + Math.max(0, (e.status.remote_total ?? 0) - e.status.bridged_messages), 0);
    if (left > 0 && summary.ratePerMinute > 0) summary.etaMs = (left / summary.ratePerMinute) * 60_000;
}

export function collectImports(client: MatrixClient, now = Date.now()): ImportOverview {
    const entries: ImportEntry[] = [];
    for (const room of client.getRooms()) {
        const status = backfillStatusOf(room);
        if (status) entries.push({ room, status, phase: historyPhase(status, now) });
    }

    const overall = emptySummary();
    const byNetwork = new Map<string, { summary: ImportSummary; entries: ImportEntry[] }>();
    for (const entry of entries) {
        add(overall, entry);
        const key = entry.status.network || "?";
        let group = byNetwork.get(key);
        if (!group) byNetwork.set(key, (group = { summary: emptySummary(), entries: [] }));
        add(group.summary, entry);
        group.entries.push(entry);
    }

    const networks: NetworkSummary[] = [...byNetwork.entries()]
        .map(([network, { summary, entries }]) => {
            finish(summary, entries);
            return { ...summary, network, entries };
        })
        .sort((a, b) => b.messages - a.messages);

    // Each bridge imports on its own, so the whole takes as long as the slowest of them.
    const etas = networks.map((n) => n.etaMs).filter((e): e is number => e !== undefined);
    if (etas.length) overall.etaMs = Math.max(...etas);

    // The queue: what is being worked on, then who is next.
    entries.sort((a, b) => {
        const order = (e: ImportEntry): number => (e.phase === "importing" ? 0 : e.phase === "queued" ? 1 : 2);
        return order(a) - order(b) || (a.status.queue_ahead ?? 0) - (b.status.queue_ahead ?? 0);
    });
    return { ...overall, entries, networks };
}
