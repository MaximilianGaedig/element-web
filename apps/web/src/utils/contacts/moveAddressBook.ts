/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Moving the address book out of global account data into its room (addressBook.ts), once.
 *
 * Run by the first session of this version that finds the old events still full, a little after startup,
 * and before any write (a write to a half-moved book would strand the rest). In order, so a failure at any
 * step leaves the old events as the place the cards are read from:
 *
 *  1. a backup of both old events, uploaded to the reader's media and named in the pointer;
 *  2. the room, and the pointer to it marked `pending` - reads stay on the old events meanwhile;
 *  3. every photo moved to media (photos.ts), and one state event per card, an alias per extra Matrix ID,
 *     and the old history carried over as the card's earlier state events, oldest first, with their times;
 *  4. the room read back whole, and every card compared with what was meant to be written - the count, and
 *     each card by a hash of its content; any difference stops here;
 *  5. the pointer unmarked, so reads switch to the room; and only then the old events emptied.
 *
 * Moving again is safe: what is already in the room is not written twice, so a move cut off half way
 * carries on. A pointer that is already final with old events left full means one of two things - the
 * emptying failed (the old content is exactly what was verified, so it is only emptied), or a client from
 * before this version wrote to them since (then what it wrote is moved over the room's copy).
 */

import { ClientEvent, type MatrixClient, SyncState } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import { type ContactCard } from "./card";
import {
    LEGACY_CARDS_TYPE,
    LEGACY_HISTORY_TYPE,
    type LegacyRevision,
    type Write,
    bookFromState,
    clearLegacy,
    createBookRoom,
    guardMove,
    hasLegacy,
    holdBook,
    legacyCards,
    legacyHistory,
    pointerOf,
    sendWrites,
    viewOf,
    writePointer,
} from "./addressBook";
import { photosToMedia } from "./photos";

/** JSON with its keys sorted, so the same card always hashes the same however it was built. */
export function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    if (value && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, one]) => one !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        return `{${entries.map(([key, one]) => `${JSON.stringify(key)}:${canonicalJson(one)}`).join(",")}}`;
    }
    return JSON.stringify(value ?? null);
}

export async function hashOf(value: unknown): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value)));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** What a move did, for the log and for the tests. Counts only: never what the cards say. */
export interface MoveReport {
    moved: boolean;
    cards?: number;
    aliases?: number;
    versions?: number;
    photos?: number;
    reason?: string;
}

async function move(client: MatrixClient): Promise<MoveReport> {
    const cards = legacyCards(client);
    const history = legacyHistory(client);
    if (!Object.keys(cards).length && !Object.keys(history).length) return { moved: false, reason: "nothing" };
    const pointer = pointerOf(client);
    const legacyHash = await hashOf({ cards, history });

    // A final pointer and old events exactly as they were when they were verified: only the emptying failed.
    if (pointer.room_id && !pointer.pending && pointer.moved_hash === legacyHash) {
        await clearLegacy(client);
        return { moved: true, reason: "emptied" };
    }

    // 1. The backup, before anything is written.
    const { content_uri: backup } = await client.uploadContent(
        new Blob([JSON.stringify({ [LEGACY_CARDS_TYPE]: { cards }, [LEGACY_HISTORY_TYPE]: { history } })], {
            type: "application/json",
        }),
        { type: "application/json", name: "contacts-backup.json" },
    );

    // 2. The room, and a pointer that keeps reads where they are until the move is verified.
    const fromScratch = !pointer.room_id || !!pointer.pending;
    const roomId = pointer.room_id ?? (await createBookRoom(client));
    if (fromScratch) await writePointer(client, { room_id: roomId, pending: true, backup });
    const book = bookFromState(roomId, await client.roomState(roomId));

    // 3. Photos out, then one card per person, an alias for each of their other ids, and the history.
    const uploaded = new Map<string, Promise<string>>();
    const expected: Record<string, ContactCard> = {};
    for (const [id, card] of Object.entries(cards)) expected[id] = await photosToMedia(client, card, uploaded);

    // A card saved for a person was copied under each of their ids: the copies are one card.
    const groups = new Map<string, string[]>();
    for (const id of Object.keys(cards).sort()) {
        const key = JSON.stringify(cards[id]);
        groups.set(key, [...(groups.get(key) ?? []), id]);
    }

    const writes: Write[] = [];
    let versions = 0;
    let aliases = 0;
    for (const ids of groups.values()) {
        const canonical = ids.find((id) => book.cards.has(id)) ?? ids[0];
        const card = expected[canonical];
        const past = ids.map((id) => history[id]).find((list) => list?.length) ?? [];
        if (!book.cards.has(canonical) && past.length) {
            // Oldest first: the oldest version, then each later one with the time and reason it replaced the one before.
            const revisions: LegacyRevision[] = [...past].reverse();
            const was = await Promise.all(revisions.map((one) => photosToMedia(client, one.was, uploaded)));
            writes.push({ kind: "card", id: canonical, card: was[0] });
            for (let at = 1; at < revisions.length; at++) {
                writes.push({
                    kind: "card",
                    id: canonical,
                    card: was[at],
                    source: revisions[at - 1].source,
                    ts: revisions[at - 1].ts,
                });
            }
            const last = revisions[revisions.length - 1];
            writes.push({ kind: "card", id: canonical, card, source: last.source, ts: last.ts });
            versions += revisions.length;
        } else if (JSON.stringify(book.cards.get(canonical)) !== JSON.stringify(card)) {
            writes.push({ kind: "card", id: canonical, card, source: "edit" });
        }
        for (const id of ids) {
            if (id === canonical) continue;
            if (book.cards.has(id)) writes.push({ kind: "card", id });
            if (book.aliases.get(id) !== canonical) writes.push({ kind: "alias", id, target: canonical });
            aliases++;
        }
    }
    // Left over from a move that was cut off and grouped differently: only the old events say what is true.
    if (fromScratch) {
        for (const id of book.cards.keys()) {
            if (!(id in expected)) writes.push({ kind: "card", id });
        }
        for (const id of book.aliases.keys()) {
            if (!(id in expected)) writes.push({ kind: "alias", id });
        }
    }
    await sendWrites(client, book, writes);

    // 4. Read back whole, and compared card by card.
    const after = bookFromState(roomId, await client.roomState(roomId));
    const view = viewOf(after);
    const wanted = Object.keys(expected);
    const problems: string[] = [];
    if (fromScratch && Object.keys(view).length !== wanted.length) {
        problems.push(`${Object.keys(view).length} cards in the room, ${wanted.length} expected`);
    }
    for (const id of wanted) {
        if ((await hashOf(view[id])) !== (await hashOf(expected[id]))) problems.push(`a card differs`);
    }
    if (problems.length) {
        logger.error(
            `contacts: moving the address book did not verify (${problems.length} problems); kept the old events`,
            problems.slice(0, 3),
        );
        return { moved: false, reason: "unverified" };
    }

    // 5. Reads switch to the room; only then is the old copy emptied.
    await writePointer(client, { room_id: roomId, backup, moved_ts: Date.now(), moved_hash: legacyHash });
    holdBook(client, after);
    await clearLegacy(client);
    return {
        moved: true,
        cards: after.cards.size,
        aliases,
        versions,
        photos: uploaded.size,
    };
}

/** Moves the cards if they are still in account data. One move per client at a time, and per browser. */
export function moveAddressBook(client: MatrixClient): Promise<boolean> {
    return guardMove(client, async () => {
        const run = async (): Promise<boolean> => {
            const report = await move(client);
            if (report.reason !== "nothing") logger.info("contacts: address book move", report);
            return report.moved;
        };
        const locks = (globalThis.navigator as Navigator | undefined)?.locks;
        return locks ? locks.request("im.mxg.contacts.move", run) : run();
    });
}

/**
 * Moves the cards a little after the first sync, if the old events still hold any: soon enough that the
 * next push to a phone no longer carries them, late enough not to compete with the chat list loading.
 */
export function moveWhenReady(client: MatrixClient, delayMs = 20_000): void {
    const later = (): void => {
        window.setTimeout(() => {
            if (!hasLegacy(client)) return;
            moveAddressBook(client).catch((error) => logger.error("contacts: moving the address book failed", error));
        }, delayMs);
    };
    if (client.isInitialSyncComplete()) {
        later();
        return;
    }
    const onSync = (state: SyncState): void => {
        if (state !== SyncState.Prepared && state !== SyncState.Syncing) return;
        client.off(ClientEvent.Sync, onSync);
        later();
    };
    client.on(ClientEvent.Sync, onSync);
}
