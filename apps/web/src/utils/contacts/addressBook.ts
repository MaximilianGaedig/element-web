/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Where the reader's address book is kept: a room of its own, not global account data.
 *
 * The cards used to be one global account data event (im.mxg.contact_cards) and their history another
 * (im.mxg.contact_history). Global account data goes to every new sync connection in full - and a phone
 * opens one for every push notification it shows - so a 200-person address book with a few photos was
 * ~580 KB downloaded a few hundred times a day for nothing. A room is only read when it is asked for.
 *
 * The room:
 *  - is private, invite-only, with the reader as its one member, and typed `im.mxg.contacts` in its
 *    m.room.create (bookRoom.ts) so the room list and the spotlight leave it out;
 *  - is found through one small global pointer, `im.mxg.contacts_room` → `{ room_id }`;
 *  - holds one `im.mxg.contact_card` state event per card, keyed by the card's own id (a Matrix ID, or
 *    `vcard:...` for a contact with no chat). A person with several Matrix IDs has one card and an
 *    `im.mxg.contact_alias` state event for each other ID, pointing at it - not a copy per ID;
 *  - keeps the history as the room's own state changes: every save is a new state event, so the earlier
 *    versions of a card are the earlier events with its state key, and deleting a version is redacting it.
 *
 * Not encrypted, and it cannot be: Matrix state events are not end-to-end encrypted. That is no change -
 * the account data it replaces was plaintext on the same server - and the server is the reader's own.
 *
 * State keys starting with "@" are reserved to the user they name (the auth rules refuse any other
 * sender), so a Matrix ID is stored as `user:@...` (stateKeyOf).
 */

import { type MatrixClient, Method, Preset, Visibility } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import { type ContactCard } from "./card";
import { CONTACTS_ROOM_TYPE } from "./bookRoom";

export const POINTER_EVENT_TYPE = "im.mxg.contacts_room" as const;
export const CARD_STATE_TYPE = "im.mxg.contact_card" as const;
export const ALIAS_STATE_TYPE = "im.mxg.contact_alias" as const;
/** Where the cards were kept before the room, read until they have been moved and then emptied. */
export const LEGACY_CARDS_TYPE = "im.mxg.contact_cards" as const;
export const LEGACY_HISTORY_TYPE = "im.mxg.contact_history" as const;

/** What changed a card, so the record says why it looks different rather than only that it does. */
export type EditSource = "edit" | "import" | "merge" | "restore";

/** A card's state event. Empty content is a card that was cleared. */
export interface CardContent {
    card?: ContactCard;
    source?: EditSource;
    /** When the change was made, for versions carried over from the old history; else the event's own time. */
    ts?: number;
}

/** Another of a person's Matrix IDs, pointing at the card that is theirs. Empty content is no alias. */
export interface AliasContent {
    card?: string;
}

export interface Pointer {
    room_id?: string;
    /** Set while the old account data is being moved in, so reads stay on the old events until it is verified. */
    pending?: boolean;
    /** The old account data as it was, uploaded to the reader's media before anything was written. */
    backup?: string;
    moved_ts?: number;
    /** A hash of the old events as they were verified, so a leftover copy is told apart from a newer write. */
    moved_hash?: string;
}

/** The book as the room holds it now. */
export interface Book {
    roomId: string;
    cards: Map<string, ContactCard>;
    /** Matrix ID → the id of the card it shares. */
    aliases: Map<string, string>;
    loadedAt: number;
}

/** A Matrix ID as a state key the reader may send, and back. */
export const stateKeyOf = (id: string): string => (id.startsWith("@") ? `user:${id}` : id);
export const idOfStateKey = (key: string): string => (key.startsWith("user:") ? key.slice(5) : key);

/** How long a loaded book is trusted before it is read again: other devices write to it too. */
const FRESH_MS = 30_000;

interface Held {
    book?: Book;
    loading?: Promise<Book | undefined>;
    /** Every card state event in the room, oldest first, by card id: the history. Dropped on every write. */
    timeline?: Promise<Map<string, CardEvent[]>>;
    moving?: Promise<boolean>;
    /**
     * What this client last wrote, ahead of its echo: the pointer, and whether the old events were emptied.
     * Written without waiting for sync to bring them back, which an emptied event may never do.
     */
    pointer?: Pointer;
    legacyCleared?: boolean;
}
const held = new WeakMap<MatrixClient, Held>();
const heldBy = (client: MatrixClient): Held => {
    let one = held.get(client);
    if (!one) held.set(client, (one = {}));
    return one;
};

export const pointerOf = (client: MatrixClient): Pointer =>
    heldBy(client).pointer ?? client.getAccountData(POINTER_EVENT_TYPE)?.getContent<Pointer>() ?? {};

/** Sets the pointer, and holds it at once rather than waiting for sync to bring it back. */
export async function writePointer(client: MatrixClient, pointer: Pointer): Promise<void> {
    await client.setAccountDataRaw(POINTER_EVENT_TYPE, pointer);
    heldBy(client).pointer = pointer;
}

/** Empties the old events, once everything in them is verified to be in the room. */
export async function clearLegacy(client: MatrixClient): Promise<void> {
    await client.setAccountDataRaw(LEGACY_CARDS_TYPE, {});
    await client.setAccountDataRaw(LEGACY_HISTORY_TYPE, {});
    heldBy(client).legacyCleared = true;
}

/** The room, once the cards live in it; before that (or while they are being moved) the old events are read. */
export const bookRoomId = (client: MatrixClient): string | undefined => {
    const pointer = pointerOf(client);
    return pointer.room_id && !pointer.pending ? pointer.room_id : undefined;
};

export const legacyCards = (client: MatrixClient): Record<string, ContactCard> =>
    heldBy(client).legacyCleared
        ? {}
        : (client.getAccountData(LEGACY_CARDS_TYPE)?.getContent<{ cards?: Record<string, ContactCard> }>()?.cards ??
          {});

export interface LegacyRevision {
    ts: number;
    source: EditSource;
    was: ContactCard;
}
export const legacyHistory = (client: MatrixClient): Record<string, LegacyRevision[]> =>
    heldBy(client).legacyCleared
        ? {}
        : (client.getAccountData(LEGACY_HISTORY_TYPE)?.getContent<{ history?: Record<string, LegacyRevision[]> }>()
              ?.history ?? {});

/** The cards and aliases in a room's current state. */
export function bookFromState(roomId: string, events: { type: string; state_key?: string; content: unknown }[]): Book {
    const book: Book = { roomId, cards: new Map(), aliases: new Map(), loadedAt: Date.now() };
    for (const event of events) {
        if (event.state_key === undefined) continue;
        const id = idOfStateKey(event.state_key);
        if (event.type === CARD_STATE_TYPE) {
            const card = (event.content as CardContent)?.card;
            if (card) book.cards.set(id, card);
        } else if (event.type === ALIAS_STATE_TYPE) {
            const target = (event.content as AliasContent)?.card;
            if (target) book.aliases.set(id, target);
        }
    }
    return book;
}

/**
 * Every card by every id it is found under - its own id and each alias - which is the shape the old
 * account data had, so readers of it need not know about the room.
 */
export function viewOf(book: Book): Record<string, ContactCard> {
    const view: Record<string, ContactCard> = {};
    for (const [id, card] of book.cards) view[id] = card;
    for (const [alias, target] of book.aliases) {
        const card = book.cards.get(target);
        if (card && !view[alias]) view[alias] = card;
    }
    return view;
}

/**
 * The cards as this client holds them now, by id: the room's when it has been read, the old account data's
 * before the move. Synchronous, for render; `loadAddressBook` is what fills it.
 */
export function heldCards(client: MatrixClient): Record<string, ContactCard> {
    const roomId = bookRoomId(client);
    if (!roomId) return legacyCards(client);
    const book = heldBy(client).book;
    return book?.roomId === roomId ? viewOf(book) : {};
}

/** Reads the room, unless what is held is recent. Does nothing before the cards have moved. */
export async function loadAddressBook(client: MatrixClient, { fresh = false } = {}): Promise<Book | undefined> {
    const roomId = bookRoomId(client);
    if (!roomId) return undefined;
    const state = heldBy(client);
    if (state.book?.roomId === roomId && !fresh && Date.now() - state.book.loadedAt < FRESH_MS) return state.book;
    if (state.loading) return state.loading;
    state.loading = client
        .roomState(roomId)
        .then((events) => {
            state.book = bookFromState(roomId, events);
            state.timeline = undefined;
            return state.book;
        })
        .catch((error) => {
            logger.warn("contacts: could not read the address book room", error);
            return state.book?.roomId === roomId ? state.book : undefined;
        })
        .finally(() => {
            state.loading = undefined;
        });
    return state.loading;
}

/* --------------------------------------------------------------------------------------------------- *
 * Writing
 * --------------------------------------------------------------------------------------------------- */

/** One state event to send. `content` undefined means clearing it. */
export type Write =
    | { kind: "card"; id: string; card?: ContactCard; source?: EditSource; ts?: number }
    | { kind: "alias"; id: string; target?: string };

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Applies writes to a book as the server will, so a plan can be built on the plan before it. */
export function applyWrites(book: Book, writes: Write[]): void {
    for (const write of writes) {
        if (write.kind === "card") {
            if (write.card) book.cards.set(write.id, write.card);
            else book.cards.delete(write.id);
        } else if (write.target) book.aliases.set(write.id, write.target);
        else book.aliases.delete(write.id);
    }
}

/**
 * What to write so that every one of `ids` says `card` (or nothing, when `card` is undefined), and every
 * other id says what it said before.
 *
 * The second half is the part that needs care. One card is shared by every alias pointing at it, so
 * overwriting it in place would also change it for an id that is not this person's any more - somebody
 * split off a merge keeps the card they had. Those keep a card of their own: the old one, under the first
 * of them, with the rest pointing there.
 */
export function planSave(book: Book, ids: string[], card: ContactCard | undefined, source: EditSource): Write[] {
    const keys = [...new Set(ids)].filter(Boolean);
    if (!keys.length) return [];
    const writes: Write[] = [];
    const ours = new Set(keys);
    const aliasesOf = (target: string): string[] =>
        [...book.aliases].filter(([, to]) => to === target).map(([alias]) => alias);

    // Cards this save overwrites in place that somebody else also reads through an alias.
    for (const id of keys) {
        if (!book.cards.has(id)) continue;
        const others = aliasesOf(id).filter((alias) => !ours.has(alias));
        if (!others.length) continue;
        const [first, ...rest] = others;
        writes.push({ kind: "card", id: first, card: book.cards.get(id), source: "edit" });
        writes.push({ kind: "alias", id: first });
        for (const alias of rest) writes.push({ kind: "alias", id: alias, target: first });
    }

    if (!card) {
        for (const id of keys) {
            if (book.cards.has(id)) writes.push({ kind: "card", id });
            if (book.aliases.has(id)) writes.push({ kind: "alias", id });
        }
        return writes;
    }

    // One card for the lot, kept where one of theirs already is so its history carries on.
    const canonical = keys.find((id) => book.cards.has(id)) ?? keys[0];
    if (!same(book.cards.get(canonical), card)) writes.push({ kind: "card", id: canonical, card, source });
    if (book.aliases.has(canonical)) writes.push({ kind: "alias", id: canonical });
    for (const id of keys) {
        if (id === canonical) continue;
        if (book.cards.has(id)) writes.push({ kind: "card", id });
        if (book.aliases.get(id) !== canonical) writes.push({ kind: "alias", id, target: canonical });
    }
    return writes;
}

const contentOf = (write: Write): CardContent | AliasContent => {
    if (write.kind === "alias") return write.target ? { card: write.target } : {};
    if (!write.card) return {};
    return {
        card: write.card,
        ...(write.source ? { source: write.source } : {}),
        ...(write.ts ? { ts: write.ts } : {}),
    };
};

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Sends one state event, waiting out the server's rate limit rather than losing the write. */
async function send(client: MatrixClient, roomId: string, write: Write): Promise<void> {
    const type = write.kind === "card" ? CARD_STATE_TYPE : ALIAS_STATE_TYPE;
    for (let attempt = 0; ; attempt++) {
        try {
            await client.sendStateEvent(roomId, type, contentOf(write), stateKeyOf(write.id));
            return;
        } catch (error) {
            const wait = (error as { data?: { retry_after_ms?: number }; errcode?: string }) ?? {};
            if (wait.errcode !== "M_LIMIT_EXCEEDED" || attempt >= 8) throw error;
            await pause(Math.min(wait.data?.retry_after_ms ?? 1000, 10_000));
        }
    }
}

/**
 * Sends writes a few at a time: cards before the aliases that point at them, and each card id's writes in
 * order, since a later one replaces an earlier one. The held book follows each write that lands.
 */
export async function sendWrites(client: MatrixClient, book: Book, writes: Write[], parallel = 4): Promise<void> {
    const byId = new Map<string, Write[]>();
    for (const write of writes) {
        const key = `${write.kind}\u0000${write.id}`;
        byId.set(key, [...(byId.get(key) ?? []), write]);
    }
    const phase = async (kind: Write["kind"]): Promise<void> => {
        const queues = [...byId].filter(([key]) => key.startsWith(`${kind}\u0000`)).map(([, list]) => list);
        const worker = async (): Promise<void> => {
            for (let queue = queues.shift(); queue; queue = queues.shift()) {
                for (const write of queue) {
                    await send(client, book.roomId, write);
                    applyWrites(book, [write]);
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(parallel, queues.length) }, worker));
    };
    await phase("card");
    await phase("alias");
}

/** Makes the room: private, only the reader in it, typed so no room list shows it as a chat. */
export async function createBookRoom(client: MatrixClient): Promise<string> {
    const { room_id: roomId } = await client.createRoom({
        preset: Preset.PrivateChat,
        visibility: Visibility.Private,
        name: "Address book",
        topic: "Your contacts, kept by Element. Not a chat.",
        creation_content: { type: CONTACTS_ROOM_TYPE },
        initial_state: [
            { type: "m.room.history_visibility", state_key: "", content: { history_visibility: "joined" } },
            { type: "m.room.guest_access", state_key: "", content: { guest_access: "forbidden" } },
        ],
    });
    // Out of the way in clients that list every room (Element X does): it is storage, not a conversation.
    await client.setRoomTag(roomId, "m.lowpriority", {}).catch(() => undefined);
    return roomId;
}

/** Whether the old account data still holds anything. */
export const hasLegacy = (client: MatrixClient): boolean =>
    Object.keys(legacyCards(client)).length > 0 || Object.keys(legacyHistory(client)).length > 0;

/**
 * The book to write to, with the cards moved in first if they are still in account data: writing one card
 * to a new room while the rest sat in the old event would leave the rest behind the moment reads switched.
 */
export async function writableBook(client: MatrixClient): Promise<Book> {
    if (!bookRoomId(client) || hasLegacy(client)) {
        const { moveAddressBook } = await import("./moveAddressBook");
        await moveAddressBook(client);
    }
    let roomId = bookRoomId(client);
    if (!roomId) {
        // Nothing to move and no room yet: the first card ever.
        roomId = await createBookRoom(client);
        await writePointer(client, { room_id: roomId });
    }
    const book = (await loadAddressBook(client)) ?? bookFromState(roomId, []);
    heldBy(client).book = book;
    return book;
}

/** Writes and drops the held history, which the writes just changed. */
export async function commit(client: MatrixClient, book: Book, writes: Write[]): Promise<void> {
    heldBy(client).timeline = undefined;
    try {
        await sendWrites(client, book, writes);
    } catch (error) {
        if ((error as { errcode?: string }).errcode !== "M_FORBIDDEN") throw error;
        // Not a member any more - somebody left the room from a client that lists it. Carried to a new one.
        await relocate(client, book);
        await sendWrites(client, book, writes);
    } finally {
        heldBy(client).timeline = undefined;
    }
}

/**
 * Copies the book into a new room and points there, for a room the reader can no longer write to.
 *
 * The room is invite-only with the reader as its only member, so leaving it - easy from a client that lists
 * every room - cannot be undone by joining again. Its state as it was when they left is still readable, which
 * is what `book` holds; the earlier versions stay behind in the old room.
 */
async function relocate(client: MatrixClient, book: Book): Promise<void> {
    const old = book.roomId;
    const cards = [...book.cards];
    const aliases = [...book.aliases];
    book.roomId = await createBookRoom(client);
    book.cards.clear();
    book.aliases.clear();
    await sendWrites(client, book, [
        ...cards.map(([id, card]): Write => ({ kind: "card", id, card })),
        ...aliases.map(([id, target]): Write => ({ kind: "alias", id, target })),
    ]);
    await writePointer(client, { ...pointerOf(client), room_id: book.roomId, pending: undefined });
    logger.warn(`contacts: could not write to the address book room ${old}; moved ${cards.length} cards to a new one`);
}

/** Saves a card against every one of `ids`. */
export async function saveCardFor(
    client: MatrixClient,
    ids: string[],
    card: ContactCard | undefined,
    source: EditSource,
): Promise<void> {
    const book = await writableBook(client);
    await commit(client, book, planSave(book, ids, card, source));
}

/** Replaces the held book, after the room was read some other way (the move verifies by reading it whole). */
export const holdBook = (client: MatrixClient, book: Book): void => {
    heldBy(client).book = book;
    heldBy(client).timeline = undefined;
};

/* --------------------------------------------------------------------------------------------------- *
 * History: the room's own state changes
 * --------------------------------------------------------------------------------------------------- */

export interface CardEvent {
    eventId: string;
    ts: number;
    content: CardContent;
}

/** Every card state event in the room, oldest first, by card id. Read once and held until the next write. */
export function cardTimeline(client: MatrixClient, roomId: string): Promise<Map<string, CardEvent[]>> {
    const state = heldBy(client);
    if (state.timeline) return state.timeline;
    const filter = JSON.stringify({ types: [CARD_STATE_TYPE] });
    const read = async (): Promise<Map<string, CardEvent[]>> => {
        const byId = new Map<string, CardEvent[]>();
        let from: string | undefined;
        // Bounded: a book is a few hundred events; this is a guard against a server that never says "end".
        for (let page = 0; page < 200; page++) {
            const response = await client.http.authedRequest<{
                chunk: {
                    type: string;
                    state_key?: string;
                    event_id: string;
                    origin_server_ts: number;
                    content: CardContent;
                }[];
                end?: string;
            }>(Method.Get, `/rooms/${encodeURIComponent(roomId)}/messages`, {
                dir: "b",
                limit: "100",
                filter,
                ...(from ? { from } : {}),
            });
            for (const event of response.chunk) {
                if (event.type !== CARD_STATE_TYPE || event.state_key === undefined) continue;
                const id = idOfStateKey(event.state_key);
                const list = byId.get(id) ?? [];
                list.unshift({
                    eventId: event.event_id,
                    ts: event.content?.ts ?? event.origin_server_ts,
                    content: event.content ?? {},
                });
                byId.set(id, list);
            }
            if (!response.end || !response.chunk.length || response.end === from) break;
            from = response.end;
        }
        return byId;
    };
    state.timeline = read().catch((error) => {
        state.timeline = undefined;
        throw error;
    });
    return state.timeline;
}

/** Redacts events, which for an earlier version of a card is deleting that version. */
export async function redactAll(client: MatrixClient, roomId: string, eventIds: string[]): Promise<void> {
    heldBy(client).timeline = undefined;
    for (const eventId of eventIds) {
        const txn = `contacts.${Date.now()}.${Math.random().toString(36).slice(2)}`;
        await client.http.authedRequest(
            Method.Put,
            `/rooms/${encodeURIComponent(roomId)}/redact/${encodeURIComponent(eventId)}/${encodeURIComponent(txn)}`,
            undefined,
            {},
        );
    }
    heldBy(client).timeline = undefined;
}

/** The card id a set of ids is stored under: the first that is a card, or that an alias of theirs points at. */
export function canonicalOf(book: Book, ids: string[]): string | undefined {
    for (const id of ids) if (book.cards.has(id)) return id;
    for (const id of ids) {
        const target = book.aliases.get(id);
        if (target && book.cards.has(target)) return target;
    }
    return undefined;
}

/** Waits until a move in progress on this client is finished, so two callers never move the cards twice. */
export function guardMove(client: MatrixClient, run: () => Promise<boolean>): Promise<boolean> {
    const state = heldBy(client);
    if (!state.moving) {
        state.moving = run().finally(() => {
            state.moving = undefined;
        });
    }
    return state.moving;
}
