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
import { type BridgeLogin } from "./bridgeLogins";

/** Where a bridge publishes its own totals: account data in the management room, state as the fallback. */
export const BACKFILL_SUMMARY_EVENT_TYPE = "im.mxg.backfill_summary";

/** A bridge's totals for its whole import, as published in [BACKFILL_SUMMARY_EVENT_TYPE]. */
interface PublishedSummary {
    network: string;
    chats: number;
    chats_by_state: Record<string, number>;
    bridged_messages: number;
    remote_messages?: number;
    counted_imported?: number;
    counted_chats?: number;
}

/** The bridge's own words for a chat's state, in the phases this file counts. */
const PHASE_OF_STATE: Record<string, HistoryPhase> = {
    complete: "complete",
    unavailable: "unavailable",
    skipped: "skipped",
    manual: "paused",
    // A bridge says only that a chat is being imported; which one it has in hand right now is something
    // the loaded rooms say, so that count is kept and taken off the queue below.
    running: "queued",
};

function publishedSummaries(client: MatrixClient): Map<string, PublishedSummary> {
    const byNetwork = new Map<string, PublishedSummary>();
    for (const room of client.getRooms()) {
        const content =
            room.getAccountData(BACKFILL_SUMMARY_EVENT_TYPE)?.getContent<PublishedSummary>() ??
            room.currentState.getStateEvents(BACKFILL_SUMMARY_EVENT_TYPE, "")?.getContent<PublishedSummary>();
        if (content?.network && content.chats) byNetwork.set(content.network, content);
    }
    return byNetwork;
}

/**
 * Replaces what was counted from the loaded rooms with what the bridge counted from all of them. With
 * sliding sync a client only ever holds some of the rooms, so every total it adds up itself reads low.
 */
function applyPublished(summary: ImportSummary, published: PublishedSummary): void {
    const importing = Math.min(summary.byPhase.importing, published.chats);
    summary.chats = published.chats;
    summary.messages = published.bridged_messages;
    summary.countedChats = published.counted_chats ?? 0;
    summary.countedTotal = published.remote_messages ?? 0;
    summary.countedImported = published.counted_imported ?? 0;
    for (const phase of PHASES) summary.byPhase[phase] = 0;
    for (const [state, count] of Object.entries(published.chats_by_state ?? {})) {
        const phase = PHASE_OF_STATE[state];
        if (phase) summary.byPhase[phase] += count;
    }
    summary.byPhase.importing = importing;
    summary.byPhase.queued = Math.max(0, summary.byPhase.queued - importing);
}

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
    const published = publishedSummaries(client);
    const entries: ImportEntry[] = [];
    for (const room of client.getRooms()) {
        const status = backfillStatusOf(room);
        if (status) entries.push({ room, status, phase: historyPhase(status, now) });
    }

    const byNetwork = new Map<string, { summary: ImportSummary; entries: ImportEntry[] }>();
    for (const entry of entries) {
        const key = entry.status.network || "?";
        let group = byNetwork.get(key);
        if (!group) byNetwork.set(key, (group = { summary: emptySummary(), entries: [] }));
        add(group.summary, entry);
        group.entries.push(entry);
    }

    const networks: NetworkSummary[] = [...byNetwork.entries()]
        .map(([network, { summary, entries }]) => {
            const totals = published.get(network);
            if (totals) applyPublished(summary, totals);
            finish(summary, entries);
            return { ...summary, network, entries };
        })
        .sort((a, b) => b.messages - a.messages);

    // The whole is the sum of the networks, each of which speaks for every chat it has, loaded or not.
    const overall = emptySummary();
    for (const network of networks) {
        overall.chats += network.chats;
        overall.messages += network.messages;
        overall.countedChats += network.countedChats;
        overall.countedImported += network.countedImported;
        overall.countedTotal += network.countedTotal;
        overall.ratePerMinute += network.ratePerMinute;
        for (const phase of PHASES) overall.byPhase[phase] += network.byPhase[phase];
    }

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

export interface QueuedEstimate {
    /** Until this chat's turn comes, judging by what is ahead of it in the same bridge's queue. */
    waitMs?: number;
    /** Until it is fully imported, at the pace its bridge is currently importing. */
    etaMs?: number;
}

/**
 * For a chat waiting its turn: the bridge imports one chat at a time, so it starts after the chats ahead of
 * it in the queue are done (those whose totals are known count for how long) and then needs its own time,
 * both at the pace of what that bridge is importing now.
 */
export function estimateQueued(overview: ImportOverview, roomId: string): QueuedEstimate {
    const me = overview.entries.find((e) => e.room.roomId === roomId);
    if (!me || me.phase !== "queued") return {};
    const network = overview.networks.find((n) => n.network === (me.status.network || "?"));
    if (!network || !network.ratePerMinute) return {};

    const left = (e: ImportEntry): number => Math.max(0, (e.status.remote_total ?? 0) - e.status.bridged_messages);
    const active = network.entries.filter((e) => e.phase === "importing");
    const ahead = network.entries.filter(
        (e) => e.phase === "queued" && (e.status.queue_ahead ?? 0) < (me.status.queue_ahead ?? 0),
    );
    const before = [...active, ...ahead].reduce((sum, e) => sum + left(e), 0);
    const own = left(me);
    const perMs = network.ratePerMinute / 60_000;
    return {
        waitMs: before > 0 ? before / perMs : undefined,
        etaMs: own > 0 ? (before + own) / perMs : undefined,
    };
}

/** What the room list's chip and the Bridges page both say about the import as a whole. */
export interface ImportHeadline {
    /** Chats no bridge has anything left to do for. */
    done: number;
    total: number;
    /** Chats a bridge is importing or has queued. */
    open: number;
    /** Chats that cannot move until a bridge is logged in again, and which networks they belong to. */
    blocked: number;
    blockedNetworks: string[];
    /** 0-99, by messages, across the networks that can count them. */
    percent?: number;
}

/**
 * Splits what is left to import into what a bridge is working through and what is waiting on the user.
 * A logged-out bridge's chats sit at "queued" forever, and counting them as progress in hand makes the
 * import look far further from done than it is.
 */
export function importHeadline(overview: ImportOverview, logins: BridgeLogin[]): ImportHeadline {
    const working = (network: string): boolean =>
        logins.some((l) => l.network === network && (l.health === "connected" || l.health === "connecting"));
    let open = 0;
    let blocked = 0;
    const blockedNetworks: string[] = [];
    for (const network of overview.networks) {
        const left = network.byPhase.importing + network.byPhase.queued + network.byPhase.paused;
        if (!left) continue;
        if (working(network.network)) {
            open += left;
        } else {
            blocked += left;
            blockedNetworks.push(network.network);
        }
    }
    return {
        done: overview.chats - open - blocked,
        total: overview.chats,
        open,
        blocked,
        blockedNetworks,
        percent: overview.countedTotal
            ? Math.min(99, Math.floor((overview.countedImported / overview.countedTotal) * 100))
            : undefined,
    };
}
