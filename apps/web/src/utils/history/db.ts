/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The local message database.
 *
 * Element asks the server every time it needs a room's media: paging back through history 50 messages
 * at a time, and for links or encrypted rooms it cannot filter at all, so it reads everything. Repeating
 * that on every visit is why the shared-media tabs took seconds to fill.
 *
 * So Element keeps what it has already seen: every message that passes through (live or fetched) is
 * stored once, indexed by room and time, and again by media kind for the shared-media tabs. Encrypted
 * rooms are stored exactly as the server sent them, still encrypted; only which tab an event belongs to
 * is kept beside it, worked out after decryption.
 *
 * This is a cache of what was fetched, not a crawl of the whole history: a room's older messages are
 * still the server's job (see the media index it offers), and per room we record where the last scan
 * stopped so the next visit continues rather than starting over.
 */

import { type IRoomEvent } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import { type SharedMediaTab } from "../sharedMedia";

const DB_NAME = "element-history";
const DB_VERSION = 2;
const EVENTS = "events";
const ROOMS = "rooms";
const LINKS = "links";

export interface StoredEvent {
    eventId: string;
    roomId: string;
    ts: number;
    /** Which shared-media tab it belongs in, if any; absent events are left out of that index. */
    tab?: SharedMediaTab;
    /** As the server sent it (an encrypted room's events stay encrypted). */
    raw: IRoomEvent;
}

export interface RoomHistoryState {
    roomId: string;
    /** Where the shared-media scan of this room got to, per source, and which sources are exhausted. */
    mediaTokens?: { url?: string; all?: string };
    mediaDone?: Array<"url" | "all">;
    /** The oldest stored event's timestamp. */
    oldestTs?: number;
    /** Where to carry on paging back, or absent once the room's start is stored. */
    backToken?: string;
    /** Whether the copy reaches the start of the room. */
    complete?: boolean;
    updatedAt: number;
}

/**
 * Where an event sits in its room's timeline, as far as Element has seen it (see localHistory.ts). Kept beside
 * the events rather than in them: an event is written again whenever it decrypts or a page brings it back,
 * and that must not lose where it was.
 */
export interface EventLink {
    eventId: string;
    roomId: string;
    /** The event just before it in the room's timeline. */
    prevId?: string;
    /** The server's token for the history before it, when it was the earliest event of a timeline. */
    backToken?: string;
    /** Nothing comes before it: it is the room's creation. */
    atStart?: boolean;
}

let db: Promise<IDBDatabase> | undefined;

/**
 * Whether this context can store anything at all. A private window may refuse IndexedDB, and a
 * worker or a test environment may simply not have it; the stored history is an optimisation, so
 * where it is missing everything here quietly does nothing rather than taking the session down
 * with it.
 */
function available(): boolean {
    return typeof indexedDB !== "undefined";
}

function open(): Promise<IDBDatabase> {
    // Every caller already treats a failure here as "no stored history"; saying why keeps the
    // warning they log from reading like a bug in the store.
    if (!available()) return Promise.reject(new Error("IndexedDB is not available in this context"));
    db ??= new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event): void => {
            const database = request.result;
            if (event.oldVersion < 1) {
                const events = database.createObjectStore(EVENTS, { keyPath: "eventId" });
                events.createIndex("room_ts", ["roomId", "ts"]);
                events.createIndex("room_tab_ts", ["roomId", "tab", "ts"]);
                database.createObjectStore(ROOMS, { keyPath: "roomId" });
            }
            if (event.oldVersion < 2) database.createObjectStore(LINKS, { keyPath: "eventId" });
        };
        request.onsuccess = (): void => {
            request.result.onclose = (): void => (db = undefined);
            resolve(request.result);
        };
        request.onerror = (): void => {
            db = undefined;
            reject(request.error);
        };
    });
    return db;
}

function promise<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = (): void => resolve(request.result);
        request.onerror = (): void => reject(request.error);
    });
}

/** Stores messages, keeping whichever copy of an event we already had (it may be decrypted). */
export async function storeEvents(events: StoredEvent[]): Promise<void> {
    if (!events.length) return;
    try {
        const database = await open();
        const txn = database.transaction(EVENTS, "readwrite");
        const store = txn.objectStore(EVENTS);
        for (const event of events) store.put(event);
        await new Promise<void>((resolve, reject) => {
            txn.oncomplete = (): void => resolve();
            txn.onerror = (): void => reject(txn.error);
        });
    } catch (e) {
        logger.warn("History: could not store messages", e);
    }
}

export async function forgetEvents(eventIds: string[]): Promise<void> {
    if (!eventIds.length) return;
    try {
        const database = await open();
        const txn = database.transaction(EVENTS, "readwrite");
        for (const id of eventIds) txn.objectStore(EVENTS).delete(id);
    } catch (e) {
        logger.warn("History: could not remove messages", e);
    }
}

/**
 * The room's stored media of one kind, newest first: what the shared-media tabs show without going to
 * the server. `beforeTs` continues from the oldest item already shown.
 */
export async function mediaPage(
    roomId: string,
    tab: SharedMediaTab,
    limit: number,
    beforeTs?: number,
): Promise<StoredEvent[]> {
    try {
        const database = await open();
        const index = database.transaction(EVENTS, "readonly").objectStore(EVENTS).index("room_tab_ts");
        const range = IDBKeyRange.bound(
            [roomId, tab, -Infinity],
            [roomId, tab, beforeTs ?? Infinity],
            false,
            beforeTs !== undefined,
        );
        return await collect(index.openCursor(range, "prev"), limit);
    } catch (e) {
        logger.warn("History: could not read stored media", e);
        return [];
    }
}

async function collect(request: IDBRequest<IDBCursorWithValue | null>, limit: number): Promise<StoredEvent[]> {
    const out: StoredEvent[] = [];
    return new Promise((resolve, reject) => {
        request.onerror = (): void => reject(request.error);
        request.onsuccess = (): void => {
            const cursor = request.result;
            if (!cursor || out.length >= limit) return resolve(out);
            out.push(cursor.value as StoredEvent);
            if (out.length >= limit) return resolve(out);
            cursor.continue();
        };
    });
}

/**
 * Records where events sit. A link that names the event before it replaces what was known; one that does not
 * (the earliest event of a timeline) only adds its token to what was already known about that event.
 */
export async function storeLinks(links: EventLink[]): Promise<void> {
    if (!links.length) return;
    try {
        const database = await open();
        const txn = database.transaction(LINKS, "readwrite");
        const store = txn.objectStore(LINKS);
        for (const link of links) {
            if (link.prevId) {
                store.put(link);
                continue;
            }
            const request = store.get(link.eventId);
            request.onsuccess = (): void => {
                const known = request.result as EventLink | undefined;
                store.put({ ...known, ...link, prevId: known?.prevId });
            };
        }
        await new Promise<void>((resolve, reject) => {
            txn.oncomplete = (): void => resolve();
            txn.onerror = (): void => reject(txn.error);
        });
    } catch (e) {
        logger.warn("History: could not record where messages sit", e);
    }
}

/** What is known about where these events sit, by event ID (absent where nothing is). */
export async function getLinks(eventIds: string[]): Promise<Map<string, EventLink>> {
    const out = new Map<string, EventLink>();
    if (!eventIds.length) return out;
    try {
        const database = await open();
        const store = database.transaction(LINKS, "readonly").objectStore(LINKS);
        const links = await Promise.all(eventIds.map((id) => promise<EventLink | undefined>(store.get(id))));
        for (const link of links) if (link) out.set(link.eventId, link);
    } catch (e) {
        logger.warn("History: could not read where messages sit", e);
    }
    return out;
}

/**
 * The stored events before `eventId` in its room, newest first, following each event to the one before it for
 * as long as both are stored, up to `limit`. With each event comes what is known about where it sits.
 */
export async function storedChainBefore(
    roomId: string,
    eventId: string,
    limit: number,
): Promise<{ start?: EventLink; chain: Array<{ event: StoredEvent; link?: EventLink }> }> {
    const chain: Array<{ event: StoredEvent; link?: EventLink }> = [];
    try {
        const database = await open();
        const txn = database.transaction([EVENTS, LINKS], "readonly");
        const events = txn.objectStore(EVENTS);
        const links = txn.objectStore(LINKS);
        const start = await promise<EventLink | undefined>(links.get(eventId));
        let prevId = start?.prevId;
        while (prevId && chain.length < limit) {
            const [event, link] = await Promise.all([
                promise<StoredEvent | undefined>(events.get(prevId)),
                promise<EventLink | undefined>(links.get(prevId)),
            ]);
            if (!event || event.roomId !== roomId) break;
            chain.push({ event, link });
            prevId = link?.prevId;
        }
        return { start, chain };
    } catch (e) {
        logger.warn("History: could not read stored history", e);
        return { chain };
    }
}

export async function getRoomHistoryState(roomId: string): Promise<RoomHistoryState | undefined> {
    try {
        const database = await open();
        return await promise(database.transaction(ROOMS, "readonly").objectStore(ROOMS).get(roomId));
    } catch (e) {
        logger.warn("History: could not read how far a room is stored", e);
        return undefined;
    }
}

export async function setRoomHistoryState(state: RoomHistoryState): Promise<void> {
    try {
        const database = await open();
        await promise(database.transaction(ROOMS, "readwrite").objectStore(ROOMS).put(state));
    } catch (e) {
        logger.warn("History: could not record how far a room is stored", e);
    }
}

/** On logout: the messages go with the session. */
export async function clearHistoryDb(): Promise<void> {
    db = undefined;
    if (!available()) return;
    await new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase(DB_NAME);
        request.onsuccess = request.onerror = request.onblocked = (): void => resolve();
    });
}
