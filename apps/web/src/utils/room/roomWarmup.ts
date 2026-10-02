/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { Direction, LOCAL_PAGINATION_PREFIX, type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import { roomsAhead } from "./roomsAhead";

/*
 * Getting a room ready before it is opened.
 *
 * A room that has not been opened this session is in memory only as far as the room list needs it:
 * after a restart, its last few events and a handful of state, with the rest of what was synced in
 * the browser's store. Opening it reads that back before the first message can be drawn, and then
 * asks the server for older history if the store had little. Both are started here a moment early
 * - when the pointer comes to rest on the room in the list, or a finger lands on it - so that the
 * click finds the room as an already-open one would be.
 *
 * It is deliberately modest. Reading the store costs next to nothing, but a request to the server
 * for every room the pointer crosses on its way down the list would be a poor trade, so those are
 * rationed (see warmupAllowance) and never follow a pointer that has already moved on.
 */

/** How long the pointer has to stay on a room before it counts as resting there. */
export const WARMUP_REST_MS = 100;

/** How many rooms a minute may have older history fetched from the server ahead of being opened. */
export const WARMUP_SERVER_ROOMS_PER_MINUTE = 4;

const MINUTE_MS = 60 * 1000;

/**
 * As many events as the timeline wants before it stops asking for more to open with (its
 * MIN_INITIAL_EVENTS). Counted here over everything in the room rather than what will be drawn:
 * deciding that needs the tile factories, which this module is loaded too early to pull in.
 */
const ENOUGH_EVENTS = 40;

/** How much history one request asks for: what the timeline itself would ask for on opening. */
const BATCH_SIZE = 100;

/** A room's stored history is one read; a second covers a store that was pruned in between. */
const MAX_STORED_READS = 2;

/** What has been warmed up so far, as far as deciding the next one goes. */
export interface WarmupHistory {
    /** The room being warmed up right now, if any. */
    inFlight: string | null;
    /** Rooms that have had all a warm-up can give them; their events stay in memory. */
    warmed: ReadonlySet<string>;
    /** When each recent request to the server was allowed (ms). */
    serverRequests: readonly number[];
}

export interface WarmupAllowance {
    /** Whether to warm the room up at all. */
    start: boolean;
    /** Whether that may go as far as asking the server for history. */
    server: boolean;
}

/**
 * Whether a room may be warmed up now, and how far.
 *
 * One room at a time, each room once, and at most {@link WARMUP_SERVER_ROOMS_PER_MINUTE} of them a
 * minute as far as the server; past that a room still gets what the browser has stored.
 */
export function warmupAllowance(history: WarmupHistory, roomId: string, now: number): WarmupAllowance {
    if (history.inFlight !== null || history.warmed.has(roomId)) return { start: false, server: false };
    const recent = history.serverRequests.filter((at) => now - at < MINUTE_MS);
    return { start: true, server: recent.length < WARMUP_SERVER_ROOMS_PER_MINUTE };
}

/**
 * Whether opening this room would have anything to wait for that could be had now: state or history
 * still in the store, or too little history in memory with more on the server.
 */
export function wantsWarmup(client: MatrixClient, room: Room): boolean {
    if (client.hasFullRoomState?.(room.roomId) === false) return true;
    const live = room.getLiveTimeline();
    const token = live.getPaginationToken(Direction.Backward);
    if (!token) return false;
    return token.startsWith(LOCAL_PAGINATION_PREFIX) || live.getEvents().length < ENOUGH_EVENTS;
}

/**
 * Does what opening the room would do first, in the same order: the stored state (the history's
 * senders take their names from it), the stored history, then one batch from the server if that
 * left the room short.
 *
 * @param mayAskServer - asked just before the request to the server, so that one is not sent for a
 *     room the pointer has since left.
 */
export async function warmUpRoom(client: MatrixClient, room: Room, mayAskServer: () => boolean): Promise<void> {
    await client.loadStoredRoomState?.(room.roomId);

    const live = room.getLiveTimeline();
    const isStored = (): boolean => !!live.getPaginationToken(Direction.Backward)?.startsWith(LOCAL_PAGINATION_PREFIX);
    for (let reads = 0; reads < MAX_STORED_READS && isStored(); reads++) {
        await client.paginateEventTimeline(live, { backwards: true, limit: BATCH_SIZE });
    }

    const moreOnServer = !!live.getPaginationToken(Direction.Backward) && !isStored();
    if (moreOnServer && live.getEvents().length < ENOUGH_EVENTS && mayAskServer()) {
        await client.paginateEventTimeline(live, { backwards: true, limit: BATCH_SIZE });
    }
}

/**
 * Warms rooms up as the reader's pointer, finger or keyboard focus lands on them in the room list.
 */
export class RoomWarmup {
    private static readonly instances = new WeakMap<MatrixClient, RoomWarmup>();

    /** One per client: the rationing is of that client's requests, whoever asks. */
    public static for(client: MatrixClient): RoomWarmup {
        let instance = RoomWarmup.instances.get(client);
        if (!instance) {
            instance = new RoomWarmup(client);
            RoomWarmup.instances.set(client, instance);
        }
        return instance;
    }

    private inFlight: string | null = null;
    private readonly warmed = new Set<string>();
    private serverRequests: number[] = [];

    /** The room the pointer is on, and the timer that decides it has come to rest there. */
    private resting: { roomId: string; timer: ReturnType<typeof setTimeout> } | null = null;

    public constructor(private readonly client: MatrixClient) {}

    /**
     * The pointer (or focus, or a finger) is on this room.
     * @param delayMs - how long it has to stay; a finger landing on a room is already resting on it.
     */
    public rest(room: Room, delayMs = WARMUP_REST_MS): void {
        if (this.resting?.roomId === room.roomId) return;
        this.leave();
        const timer = setTimeout(() => this.start(room), delayMs);
        this.resting = { roomId: room.roomId, timer };
    }

    /** It moved off (any room, or only this one): nothing further is started on its account. */
    public leave(room?: Room): void {
        if (!this.resting || (room && this.resting.roomId !== room.roomId)) return;
        clearTimeout(this.resting.timer);
        this.resting = null;
    }

    private start(room: Room): void {
        const { roomId } = room;
        // Its view as well as its events: mounted behind the room on screen, so the click only brings it
        // forward (see roomsAhead). Asked for before the events are in - the view fills in as they come,
        // exactly as it does when it is opened, and is the longer of the two to get ready.
        roomsAhead.prepare(roomId);
        const now = Date.now();
        const history = { inFlight: this.inFlight, warmed: this.warmed, serverRequests: this.serverRequests };
        const allowance = warmupAllowance(history, roomId, now);
        if (!allowance.start || !wantsWarmup(this.client, room)) return;

        this.inFlight = roomId;
        let askedServer = false;
        // Still on the room, and still within the ration: decided when the request is about to go.
        const mayAskServer = (): boolean => {
            if (!allowance.server || this.resting?.roomId !== roomId) return false;
            this.serverRequests = [...this.serverRequests.filter((at) => now - at < MINUTE_MS), now];
            askedServer = true;
            return true;
        };
        warmUpRoom(this.client, room, mayAskServer)
            .then(() => {
                // A room refused the server's share may still have it another time; one that has
                // had it is done, however little came back.
                if (askedServer || !wantsWarmup(this.client, room)) this.warmed.add(roomId);
            })
            // Opening the room does all of this again for itself, so a failure here costs nothing.
            .catch((e) => logger.warn(`Failed to warm up room ${roomId}`, e))
            .finally(() => (this.inFlight = null));
    }
}
