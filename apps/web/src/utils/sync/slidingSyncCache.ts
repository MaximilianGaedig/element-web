/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * What sliding sync shows on the next startup, before it has made a single request.
 *
 * Sliding sync keeps nothing between sessions: every start waited for the server, and offline there was
 * nothing at all. Here each room is kept as the server last described it - the state the chat list reads
 * and the last few messages - with the account data, in two records: the rooms at the top of the list
 * (with the favourites, the invites and the account data) and all the others. The first is small and is
 * read and shown at once; the second follows (see SlidingSyncCache in the SDK).
 */

import {
    ClientEvent,
    EventType,
    type IRoomEvent,
    type IStateEvent,
    type MatrixClient,
    type MatrixEvent,
    type Room,
    RoomEvent,
    type SlidingSyncCache,
    type SlidingSyncSnapshot,
} from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";
import { logger } from "matrix-js-sdk/src/logger";
import {
    type MSC3575RoomData,
    type MSC3575SlidingSyncResponse,
    type SlidingSync,
    SlidingSyncEvent,
    SlidingSyncState,
} from "matrix-js-sdk/src/sliding-sync";

import { PREVIEW_FIELD, setServerPreview } from "./serverPreviews";

const DB_NAME = "mx-sliding-sync-cache";
const STORE = "snapshots";

/**
 * How many of a room's latest events are kept: as many as the lists ask for (LIST_TIMELINE_LIMIT), so that
 * the one its line in the list shows is among them - the very latest is often a delivery status or a
 * reaction.
 */
export const CACHED_TIMELINE = 10;
/** How many of the most recently active rooms are in the first record. */
export const FIRST_ROOMS = 40;
/** How long after a change the cache is written: changes come in bursts. */
const SAVE_DELAY_MS = 3000;

type CachedRoom = Partial<Omit<MSC3575RoomData, "required_state" | "timeline">> & {
    required_state: IStateEvent[];
    timeline: (IRoomEvent | IStateEvent)[];
    /** Sent by servers though not in the SDK's type: the room's avatar, as the list shows it. */
    avatar?: string;
    /** The room's newest message, for the chat list, as the server last sent it (serverPreviews.ts). */
    [PREVIEW_FIELD]?: IRoomEvent;
};

interface Snapshots {
    first: SlidingSyncSnapshot | null;
    rest: Record<string, MSC3575RoomData> | null;
}

const SCALARS = [
    "name",
    "avatar",
    "heroes",
    "notification_count",
    "highlight_count",
    "joined_count",
    "invited_count",
    "bump_stamp",
    "is_dm",
    "invite_state",
    PREVIEW_FIELD,
] as const;

/**
 * Folds a room's update into what is kept of it: state replaced by type and key, the timeline's tail, and
 * the counts and names as the server last gave them. Only the state the chat list reads is kept (see
 * `keepState`): an encrypted room is subscribed to with all its state, which can be thousands of members.
 */
export function mergeRoomData(
    kept: CachedRoom | undefined,
    data: MSC3575RoomData,
    keepState: (event: IStateEvent) => boolean,
): CachedRoom {
    const room: CachedRoom = kept && !data.initial ? { ...kept } : { required_state: [], timeline: [] };
    if (data.initial && kept) {
        // A new description of the room: what was kept of its timeline still holds if the new one carries on
        // from it, and the state the new one leaves out (it may ask for less) is kept rather than lost.
        room.required_state = kept.required_state;
        room.timeline = kept.timeline;
        room.prev_batch = kept.prev_batch;
    }
    const given = data as unknown as Record<string, unknown>;
    for (const key of SCALARS) {
        if (given[key] !== undefined) (room as Record<string, unknown>)[key] = given[key];
    }

    const state = new Map(room.required_state.map((event) => [`${event.type}\u0000${event.state_key}`, event]));
    for (const event of data.required_state ?? []) {
        if (keepState(event)) state.set(`${event.type}\u0000${event.state_key}`, event);
    }
    room.required_state = [...state.values()];

    const incoming = data.timeline ?? [];
    let timeline = room.timeline;
    // A limited timeline that does not reach back to the earliest kept event replaces what is kept: kept above
    // it, the earlier events would sit over a gap no token leads into (as the SDK does with them too).
    if (data.limited && incoming.length && !incoming.some((event) => event.event_id === timeline[0]?.event_id)) {
        timeline = [];
    }
    const seen = new Set(timeline.map((event) => event.event_id));
    const merged = [...timeline, ...incoming.filter((event) => !seen.has(event.event_id))];
    room.timeline = merged.slice(-CACHED_TIMELINE);
    // The token for the history before the earliest kept event, while it is still the one the server gave
    // with it: the next session's timeline goes back from there. Once that event is dropped (only the latest
    // few are kept) the token would lead back from somewhere else, and there is none until the live sync
    // sends one.
    const earliest = room.timeline[0]?.event_id;
    if (incoming.length && earliest === incoming[0].event_id) room.prev_batch = data.prev_batch;
    else if (earliest !== timeline[0]?.event_id) room.prev_batch = undefined;
    return room;
}

/** The events a room's chat-list line can show: what its timeline is kept from (see fromNewestMessage). */
const MESSAGE_TYPES: ReadonlySet<string> = new Set([
    EventType.RoomMessage,
    EventType.RoomMessageEncrypted,
    EventType.Sticker,
    EventType.CallInvite,
    "m.poll.start",
    "org.matrix.msc3381.poll.start",
]);

/**
 * What is written of a room's timeline: its newest message and what came after it, not the events before.
 *
 * The lists ask for ten events so that a message is among them, but every session replays what is written,
 * and in most chats the message is one of the last few (a delivery status or a reaction follows it): ~7000
 * events for 700 rooms, where ~2000 do. The events left out are in the message database with the token before
 * them (utils/history/localHistory), so scrolling back from the message carries on there. Their own token no
 * longer fits the first event kept and goes; a room with no message among its events is written whole.
 */
export function fromNewestMessage(room: CachedRoom): CachedRoom {
    let newest = -1;
    room.timeline.forEach((event, i) => {
        if (MESSAGE_TYPES.has(event.type) && !(event as IStateEvent).state_key) newest = i;
    });
    if (newest <= 0) return room;
    return { ...room, timeline: room.timeline.slice(newest), prev_batch: undefined };
}

/** What a cached room is replayed as: complete as far as it goes, with its earlier history to be asked for. */
function asRoomData(cached: CachedRoom): MSC3575RoomData {
    const room = fromNewestMessage(cached);
    return { ...room, name: room.name ?? "", initial: true, limited: true, num_live: 0, prev_batch: room.prev_batch };
}

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = (): void => {
            request.result.createObjectStore(STORE);
        };
        request.onsuccess = (): void => resolve(request.result);
        request.onerror = (): void => reject(request.error);
    });
}

async function read(key: string): Promise<unknown> {
    const db = await openDb();
    try {
        return await new Promise((resolve, reject) => {
            const request = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
            request.onsuccess = (): void => resolve(request.result);
            request.onerror = (): void => reject(request.error);
        });
    } finally {
        db.close();
    }
}

async function write(entries: Record<string, unknown>): Promise<void> {
    const db = await openDb();
    try {
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE, "readwrite");
            for (const [key, value] of Object.entries(entries)) tx.objectStore(STORE).put(value, key);
            tx.oncomplete = (): void => resolve();
            tx.onerror = (): void => reject(tx.error);
        });
    } finally {
        db.close();
    }
}

/** Where the other way of syncing keeps its stored /sync (createMatrixClient's IndexedDBStore). */
const LEGACY_SYNC_DB = "matrix-js-sdk:riot-web-sync";

/**
 * Lets go of the other sync's stored /sync once sliding sync is in use: it is not read any more, and it is
 * the larger of the two by far.
 */
export function forgetLegacySyncStore(): Promise<void> {
    return deleteDatabase(LEGACY_SYNC_DB);
}

/** Deletes a database, if there is one and anywhere to keep one; never fails, as nothing waits on it. */
function deleteDatabase(name: string): Promise<void> {
    return new Promise((resolve) => {
        try {
            const request = indexedDB.deleteDatabase(name);
            request.onsuccess = request.onerror = request.onblocked = (): void => resolve();
        } catch {
            resolve();
        }
    });
}

/** Forgets every user's cached rooms: on logout, with the rest of the stores. */
export function clearSlidingSyncCache(): Promise<void> {
    return deleteDatabase(DB_NAME);
}

/**
 * Keeps one user's sliding sync for the next session, and hands the SDK what the last one kept.
 */
export class SlidingSyncCacheStore implements SlidingSyncCache {
    private readonly rooms = new Map<string, CachedRoom>();
    private readonly globalAccountData = new Map<string, { type: string; content: object }>();
    private saveTimer?: ReturnType<typeof setTimeout>;
    private loadedRest?: Promise<Record<string, MSC3575RoomData> | null>;
    /** The `pos` of the last response taken in whole (see SlidingSyncSnapshot.pos). */
    private pos?: string;
    /** Set once recording starts: what server previews are made into events with. */
    private client?: MatrixClient;

    public constructor(private readonly userId: string) {}

    /** Hands the chat list the previews the server sent with these rooms. */
    private showPreviews(rooms: Record<string, MSC3575RoomData> | undefined): void {
        if (!this.client) return;
        for (const [roomId, data] of Object.entries(rooms ?? {})) {
            const preview = (data as CachedRoom)[PREVIEW_FIELD];
            if (preview) setServerPreview(this.client, roomId, preview);
        }
    }

    private key(part: "first" | "rest"): string {
        return `${this.userId}:${part}`;
    }

    // ── For the SDK: what the last session kept ──

    public async loadFirst(): Promise<SlidingSyncSnapshot | null> {
        // Both are read now: the second is wanted moments later, and reading them together costs one open.
        this.loadedRest = read(this.key("rest")).then((value) => (value as Snapshots["rest"]) ?? null);
        const first = ((await read(this.key("first"))) as Snapshots["first"]) ?? null;
        for (const [roomId, data] of Object.entries(first?.rooms ?? {})) {
            this.rooms.set(roomId, data);
        }
        this.showPreviews(first?.rooms);
        // Carried over until the live sync gets further: a session that never reaches the server writes the
        // next one what it was given, from the same position.
        this.pos = first?.pos;
        // Kept until the live sync sends its own: a session that never reaches the server must not write
        // the next one a cache without them.
        for (const event of first?.accountData.global ?? []) {
            this.globalAccountData.set(event.type, { type: event.type, content: event.content });
        }
        return first;
    }

    public async loadRest(): Promise<Record<string, MSC3575RoomData> | null> {
        const rest = (await this.loadedRest) ?? null;
        for (const [roomId, data] of Object.entries(rest ?? {})) {
            if (!this.rooms.has(roomId)) this.rooms.set(roomId, data);
        }
        this.showPreviews(rest ?? undefined);
        return rest;
    }

    // ── From the live sync: what to keep for the next one ──

    /** Starts keeping what sliding sync and the client say from now on. */
    public record(slidingSync: SlidingSync, client: MatrixClient): () => void {
        this.client = client;
        const onRoomData = (roomId: string, data: MSC3575RoomData): void => {
            const preview = (data as CachedRoom)[PREVIEW_FIELD];
            if (preview) setServerPreview(client, roomId, preview);
            const heroes = new Set((data.heroes ?? []).map((hero) => hero.user_id));
            const senders = new Set((data.timeline ?? []).map((event) => event.sender));
            // All of a room's state but its members: the connection carries on from the cache, and the
            // server does not send again what it has sent, so a topic or pinned messages dropped here would
            // stay missing. Members are the bulk (an encrypted room is subscribed to with all of them), and
            // are loaded again when needed: in full before anything is encrypted, and for the member list.
            const keepState = (event: IStateEvent): boolean =>
                event.type !== EventType.RoomMember ||
                event.state_key === this.userId ||
                heroes.has(event.state_key) ||
                senders.has(event.state_key);
            this.rooms.set(roomId, mergeRoomData(this.rooms.get(roomId), data, keepState));
            this.scheduleSave(client);
        };
        const onAccountData = (event: MatrixEvent): void => {
            this.globalAccountData.set(event.getType(), { type: event.getType(), content: event.getContent() });
            this.scheduleSave(client);
        };
        const onRoomAccountData = (): void => this.scheduleSave(client);
        const onMembership = (room: Room, membership: string): void => {
            if (membership === KnownMembership.Leave || membership === KnownMembership.Ban) {
                this.rooms.delete(room.roomId);
                this.scheduleSave(client);
            }
        };
        // Where the connection has got to, once a response has been taken in whole: the next session
        // carries on from it, and is sent only what changed since.
        const onLifecycle = (state: SlidingSyncState, response: MSC3575SlidingSyncResponse | null): void => {
            if (state !== SlidingSyncState.Complete || !response?.pos) return;
            this.pos = response.pos;
            this.scheduleSave(client);
        };
        const onHide = (): void => {
            if (document.visibilityState === "hidden") void this.save(client);
        };
        slidingSync.on(SlidingSyncEvent.RoomData, onRoomData);
        slidingSync.on(SlidingSyncEvent.Lifecycle, onLifecycle);
        client.on(ClientEvent.AccountData, onAccountData);
        client.on(RoomEvent.AccountData, onRoomAccountData);
        client.on(RoomEvent.MyMembership, onMembership);
        document.addEventListener("visibilitychange", onHide);
        return (): void => {
            slidingSync.off(SlidingSyncEvent.RoomData, onRoomData);
            slidingSync.off(SlidingSyncEvent.Lifecycle, onLifecycle);
            client.off(ClientEvent.AccountData, onAccountData);
            client.off(RoomEvent.AccountData, onRoomAccountData);
            client.off(RoomEvent.MyMembership, onMembership);
            document.removeEventListener("visibilitychange", onHide);
            clearTimeout(this.saveTimer);
        };
    }

    private scheduleSave(client: MatrixClient): void {
        if (this.saveTimer !== undefined) return;
        this.saveTimer = setTimeout(() => {
            this.saveTimer = undefined;
            void this.save(client);
        }, SAVE_DELAY_MS);
    }

    /** Splits what is kept into the first screen's record and the rest's, and writes both. */
    public async save(client: MatrixClient): Promise<void> {
        const roomAccountData: Record<string, { type: string; content: object }[]> = {};
        const favourite = new Set<string>();
        for (const roomId of this.rooms.keys()) {
            const room = client.getRoom(roomId);
            if (!room) continue;
            const events = [...room.accountData.values()].map((event) => ({
                type: event.getType(),
                content: event.getContent(),
            }));
            if (events.length) roomAccountData[roomId] = events;
            if (room.tags["m.favourite"]) favourite.add(roomId);
        }
        const byRecency = [...this.rooms.entries()].sort(([, a], [, b]) => (b.bump_stamp ?? 0) - (a.bump_stamp ?? 0));
        const first: Record<string, MSC3575RoomData> = {};
        const rest: Record<string, MSC3575RoomData> = {};
        byRecency.forEach(([roomId, room], index) => {
            const toFirst = index < FIRST_ROOMS || favourite.has(roomId) || !!room.invite_state;
            (toFirst ? first : rest)[roomId] = asRoomData(room);
        });
        const global = [...this.globalAccountData.values()];
        try {
            await write({
                [this.key("first")]: {
                    rooms: first,
                    accountData: { global, rooms: roomAccountData },
                    pos: this.pos,
                } satisfies SlidingSyncSnapshot,
                [this.key("rest")]: rest,
            });
        } catch (error) {
            logger.warn("Could not keep sliding sync for the next session", error);
        }
    }
}
