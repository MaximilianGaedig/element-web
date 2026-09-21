/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Everything the chats turned out to contain, kept where it can be looked at.
 *
 * Detection already happens per message (utils/detect/entities.ts): a date, a phone number, an address, a
 * flight, a parcel. It is offered under the message it was found in and then thrown away, which means the
 * dentist appointment somebody sent three weeks ago is findable only by remembering which chat it was in
 * and scrolling to it. So what is found is also written down here, once, and can then be read by kind:
 * what has not happened yet, soonest first; numbers; addresses; things on their way.
 *
 * Nothing leaves the device. This is a reading of messages the client already holds, kept in the browser
 * in a database of its own, per account - not in account data, which syncs, and not on the server, which
 * has no business with a list of everywhere the reader has been asked to be.
 *
 * Every row says which message it came from, because a list of facts with no way back to who said them is
 * a list nobody can trust. A message that is redacted takes its rows with it (forget).
 */

import { type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import { type Detected } from "./entities";
import { getIDBFactory } from "../StorageAccess";

/** One thing found in one message, with everything needed to show it and to get back to it. */
export interface Collected {
    /** The message and where in it: one message can hold a date and an address both. */
    id: string;
    event: string;
    room: string;
    /** Who wrote the message it was found in. */
    sender: string;
    /** When that message was sent. */
    ts: number;
    kind: Detected["kind"];
    /** The words as they were written, which is what to show. */
    text: string;
    /**
     * What to sort by.
     *
     * For an arrangement it is when the arrangement is, so "soonest first" is a plain ordering and "has
     * not happened yet" is a comparison with now. For everything else it is when the message was sent,
     * so the newest is first. One index, one ordering, both questions answered.
     */
    at: number;
    /** Where it goes: a map, a carrier's tracking page, an airline's, the link itself. */
    url?: string;
    /** The one other thing worth showing: the dialling form, the carrier, the airline, the conversion. */
    extra?: string;
}

const DB = "mxg-detected";
const STORE = "found";
/**
 * Which messages have been read for this, whether or not anything was found in them.
 *
 * Most messages contain none of these, so "has this one been read?" cannot be answered by looking for
 * rows about it - that answer is "no" forever, and the sweep reads the same thousand messages on every
 * start. A message is marked here once, and never read again.
 */
const SEEN = "seen";
/** By kind and then by `at`, which is the only ordering any of the lists want. */
const BY_KIND = "kind-at";
/** By message, so a redaction can take its rows with it. */
const BY_EVENT = "event";

/**
 * One handle per account, not one handle.
 *
 * Signing out and into a second account in the same page would otherwise go on reading and writing the
 * first account's database, which is the one thing this must never do.
 */
const handles = new Map<string, Promise<IDBDatabase | undefined>>();

/**
 * The database for this account.
 *
 * Per account, because two people using one browser should not read each other's appointments out of a
 * shared list. Anything that goes wrong here leaves the feature off rather than breaking a chat: a
 * private window, storage denied, a quota - all of them mean "no collection", and none of them mean the
 * timeline should fail to render.
 */
function database(userId: string): Promise<IDBDatabase | undefined> {
    const had = handles.get(userId);
    if (had) return had;
    const opening = new Promise<IDBDatabase | undefined>((resolve) => {
        const factory = getIDBFactory();
        if (!factory) return resolve(undefined);
        const request = factory.open(`${DB}:${userId}`, 1);
        request.onerror = () => resolve(undefined);
        request.onblocked = () => resolve(undefined);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = () => {
            const store = request.result.createObjectStore(STORE, { keyPath: "id" });
            store.createIndex(BY_KIND, ["kind", "at"]);
            store.createIndex(BY_EVENT, "event");
            request.result.createObjectStore(SEEN, { keyPath: "event" });
        };
    }).catch(() => undefined);
    handles.set(userId, opening);
    return opening;
}

/** One transaction, resolved when it commits rather than when the last request returns. */
async function write(
    userId: string,
    names: string | string[],
    work: (...stores: IDBObjectStore[]) => void,
): Promise<void> {
    const db = await database(userId);
    if (!db) return;
    const wanted = Array.isArray(names) ? names : [names];
    await new Promise<void>((resolve) => {
        const transaction = db.transaction(wanted, "readwrite");
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
        transaction.onabort = () => resolve();
        work(...wanted.map((name) => transaction.objectStore(name)));
    });
}

/** What one detection comes down to on disk: the row, or nothing where there is nothing to keep. */
function rowFor(event: MatrixEvent, found: Detected): Collected | undefined {
    const eventId = event.getId();
    const roomId = event.getRoomId();
    if (!eventId || !roomId) return undefined;
    const ts = event.getTs();
    const common = {
        id: `${eventId}:${found.start}`,
        event: eventId,
        room: roomId,
        sender: event.getSender() ?? "",
        ts,
        kind: found.kind,
        text: found.text,
        at: ts,
    };
    switch (found.kind) {
        case "datetime":
            // The one kind sorted by what it means rather than by when it was said.
            return { ...common, at: found.date.getTime(), extra: found.hasTime ? "time" : "day" };
        case "phone":
            return { ...common, extra: found.number, url: `tel:${found.number}` };
        case "address":
            return { ...common, url: found.url };
        case "flight":
            return { ...common, url: found.url, extra: found.airline };
        case "parcel":
            return { ...common, url: found.url, extra: found.carrier };
        case "url":
            return { ...common, url: found.url };
        case "measure":
            // A conversion is true of the words and of nothing else: there is no list of them worth keeping.
            return undefined;
    }
}

/**
 * Writes down what a message turned out to contain.
 *
 * Called from wherever detection already ran, so nothing is detected twice for the sake of this: a
 * message on screen has been read anyway (views/messages/DetectedActions.tsx), and the sweep over what is
 * loaded but was never on screen is in collect.ts.
 */
export async function remember(userId: string, event: MatrixEvent, found: Detected[]): Promise<void> {
    const eventId = event.getId();
    if (!eventId) return;
    const rows = found.map((one) => rowFor(event, one)).filter((row): row is Collected => !!row);
    try {
        // Marked as read either way: a message with nothing in it is a message not to read again.
        await write(userId, [STORE, SEEN], (store, seen) => {
            for (const row of rows) store.put(row);
            seen.put({ event: eventId, ts: event.getTs() });
        });
    } catch (error) {
        logger.warn("Could not keep what was found in a message", error);
    }
}

/** A message that is gone takes what was found in it with it. */
export async function forget(userId: string, eventId: string): Promise<void> {
    await write(userId, STORE, (store) => {
        const index = store.index(BY_EVENT);
        const request = index.openKeyCursor(IDBKeyRange.only(eventId));
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return;
            store.delete(cursor.primaryKey);
            cursor.continue();
        };
    });
}

/** Which kinds are worth a list, in the order the view shows them. */
export const KINDS = ["datetime", "phone", "address", "flight", "parcel", "url"] as const;

/**
 * What was found of one kind.
 *
 * Read back to front for everything except arrangements, where the question is "what is coming" rather
 * than "what was said lately" - so those are read forwards from now, and what is already past is read
 * backwards from it.
 */
export async function collectedOf(
    userId: string,
    kind: Collected["kind"],
    { limit = 200, past = false }: { limit?: number; past?: boolean } = {},
): Promise<Collected[]> {
    const db = await database(userId);
    if (!db) return [];
    const upcoming = kind === "datetime" && !past;
    const now = Date.now();
    const range = upcoming
        ? IDBKeyRange.bound([kind, now], [kind, Infinity])
        : kind === "datetime"
          ? IDBKeyRange.bound([kind, -Infinity], [kind, now])
          : IDBKeyRange.bound([kind, -Infinity], [kind, Infinity]);

    return new Promise<Collected[]>((resolve) => {
        const rows: Collected[] = [];
        const request = db
            .transaction(STORE, "readonly")
            .objectStore(STORE)
            .index(BY_KIND)
            // Soonest first for what is still to come; newest first for everything else.
            .openCursor(range, upcoming ? "next" : "prev");
        request.onerror = () => resolve(rows);
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor || rows.length >= limit) return resolve(rows);
            rows.push(cursor.value as Collected);
            cursor.continue();
        };
    }).catch(() => []);
}

/** How many of each kind there are, for a view that says so before it is opened. */
export async function counts(userId: string): Promise<Partial<Record<Collected["kind"], number>>> {
    const db = await database(userId);
    if (!db) return {};
    const store = db.transaction(STORE, "readonly").objectStore(STORE).index(BY_KIND);
    const entries = await Promise.all(
        KINDS.map(
            (kind) =>
                new Promise<[Collected["kind"], number]>((resolve) => {
                    const request = store.count(IDBKeyRange.bound([kind, -Infinity], [kind, Infinity]));
                    request.onerror = () => resolve([kind, 0]);
                    request.onsuccess = () => resolve([kind, request.result]);
                }),
        ),
    );
    return Object.fromEntries(entries.filter(([, count]) => count > 0));
}

/**
 * Which of these messages have not been read yet.
 *
 * Asked for the whole batch in one transaction rather than one message at a time: the sweep's first
 * question about a screenful of chat should not be a hundred round trips. Where the database cannot be
 * had at all the honest answer is "none of them need reading", which leaves the feature off.
 */
export async function unread(userId: string, eventIds: string[]): Promise<string[]> {
    const db = await database(userId);
    if (!db) return [];
    return new Promise<string[]>((resolve) => {
        const seen = db.transaction(SEEN, "readonly").objectStore(SEEN);
        const missing: string[] = [];
        let left = eventIds.length;
        if (!left) return resolve(missing);
        for (const eventId of eventIds) {
            const request = seen.count(eventId);
            const done = (): void => {
                if (--left === 0) resolve(missing);
            };
            request.onerror = done;
            request.onsuccess = () => {
                if (!request.result) missing.push(eventId);
                done();
            };
        }
    }).catch(() => []);
}
