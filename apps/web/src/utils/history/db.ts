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
const DB_VERSION = 1;
const EVENTS = "events";
const ROOMS = "rooms";

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

let db: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
    db ??= new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (): void => {
            const database = request.result;
            const events = database.createObjectStore(EVENTS, { keyPath: "eventId" });
            events.createIndex("room_ts", ["roomId", "ts"]);
            events.createIndex("room_tab_ts", ["roomId", "tab", "ts"]);
            database.createObjectStore(ROOMS, { keyPath: "roomId" });
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

/** The room's stored messages just before `ts`, oldest first: scrollback without the server. */
export async function eventsBefore(roomId: string, ts: number, limit: number): Promise<StoredEvent[]> {
    try {
        const database = await open();
        const index = database.transaction(EVENTS, "readonly").objectStore(EVENTS).index("room_ts");
        const range = IDBKeyRange.bound([roomId, -Infinity], [roomId, ts], false, true);
        const events = await collect(index.openCursor(range, "prev"), limit);
        return events.reverse();
    } catch (e) {
        logger.warn("History: could not read stored messages", e);
        return [];
    }
}

/** The stored message closest to `ts` (jump to date), or undefined when that time isn't stored yet. */
export async function eventAt(roomId: string, ts: number): Promise<StoredEvent | undefined> {
    try {
        const database = await open();
        const index = database.transaction(EVENTS, "readonly").objectStore(EVENTS).index("room_ts");
        const after = await collect(index.openCursor(IDBKeyRange.bound([roomId, ts], [roomId, Infinity]), "next"), 1);
        return after[0];
    } catch (e) {
        logger.warn("History: could not look up a time", e);
        return undefined;
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
    await new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase(DB_NAME);
        request.onsuccess = request.onerror = request.onblocked = (): void => resolve();
    });
}
