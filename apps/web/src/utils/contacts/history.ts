/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * What a contact used to say, so an edit can be traced and undone.
 *
 * A contact card is typed once and then quietly overwritten - by the reader mis-editing it, by an import
 * landing on the wrong person, by a merge bringing two cards together. None of those announce themselves,
 * and without a record the older version is simply gone: account data keeps no history of its own, and the
 * only copy of a phone number somebody typed a year ago was the one that just got replaced.
 *
 * Modelled on how a password manager keeps an entry's history, KeePassXC in particular (Entry::beginUpdate,
 * Entry::truncateHistory, Entry::restoreFromHistoryItem in its src/core/Entry.cpp), because that is the same
 * problem solved for records that matter more:
 *
 *  - every save keeps the previous version, so the record is of versions rather than of diffs;
 *  - restoring a version is itself a save, so it keeps the current one too and can be undone in turn;
 *  - a version can be read without being restored, thrown away one at a time, or the lot emptied at once.
 *
 * The versions are the address book room's own state changes (addressBook.ts): every save of a card is a new
 * state event under the card's id, so the earlier events with that id are its earlier versions - nothing is
 * kept twice, and nothing here is synced to every device. Throwing a version away is redacting its event.
 * Before the cards have moved to the room, the old account data event is read instead.
 */

import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { type ContactCard, cardIdsOf } from "./card";
import { type Person } from "./people";
import {
    type EditSource,
    bookRoomId,
    canonicalOf,
    cardTimeline,
    legacyHistory,
    loadAddressBook,
    redactAll,
    writableBook,
} from "./addressBook";

export type { EditSource } from "./addressBook";

export interface Revision {
    /** When the change was made. */
    ts: number;
    /** What made it. */
    source: EditSource;
    /**
     * The card as it was *before* this change.
     *
     * Before rather than after, so restoring a revision is just writing it back: a log of afters needs the
     * one before the one you picked, which is the sort of off-by-one that loses somebody's address.
     */
    was: ContactCard;
    /** The state event that holds `was`, which is what deleting this version redacts. */
    id?: string;
}

/** How many versions are shown, newest first. */
export const KEEP = 20;

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** What the old account data event held for this person, before the cards moved to the room. */
function legacyFor(client: MatrixClient, person: Person): Revision[] {
    const history = legacyHistory(client);
    for (const id of cardIdsOf(person)) {
        const found = history[id];
        if (found?.length) return found.slice(0, KEEP);
    }
    return [];
}

/**
 * What this person's card has said before now, newest first, as far as this client holds it without asking:
 * the old account data before the move, and nothing after it - `loadHistory` reads the room.
 */
export function historyFor(client: MatrixClient, person: Person): Revision[] {
    return bookRoomId(client) ? [] : legacyFor(client, person);
}

/** What this person's card has said before now, newest first, read from the room's state changes. */
export async function loadHistory(client: MatrixClient, person: Person): Promise<Revision[]> {
    const roomId = bookRoomId(client);
    if (!roomId) return legacyFor(client, person);
    const book = await loadAddressBook(client);
    const id = book && canonicalOf(book, cardIdsOf(person));
    if (!id) return [];
    const events = (await cardTimeline(client, roomId)).get(id) ?? [];
    const revisions: Revision[] = [];
    for (let at = events.length - 1; at >= 1 && revisions.length < KEEP; at--) {
        const before = events[at - 1];
        const after = events[at];
        // Nothing to go back to: a version thrown away (redacted), or a card that did not exist yet.
        if (!before.content.card) continue;
        // A save that changed nothing is not a version.
        if (same(before.content.card, after.content.card)) continue;
        revisions.push({
            ts: after.ts,
            source: after.content.source ?? "edit",
            was: before.content.card,
            id: before.eventId,
        });
    }
    return revisions;
}

/** The history as the room holds it, moving the cards there first if they have not moved yet. */
async function roomHistory(client: MatrixClient, person: Person): Promise<{ roomId: string; revisions: Revision[] }> {
    const book = await writableBook(client);
    return { roomId: book.roomId, revisions: await loadHistory(client, person) };
}

/**
 * Throws away one version, leaving the rest.
 *
 * Per version as well as all of it, because the reason to delete history is usually one particular version:
 * an import that briefly wrote somebody's home address into the wrong card is the thing to remove, and
 * emptying the lot to get rid of it also removes the version you would have restored.
 */
export async function deleteRevision(client: MatrixClient, person: Person, revision: Revision): Promise<void> {
    const { roomId, revisions } = await roomHistory(client, person);
    // A version shown before the move has no event yet; after it, the same version is found by its time.
    const id = revision.id ?? revisions.find((one) => one.ts === revision.ts)?.id;
    if (id) await redactAll(client, roomId, [id]);
}

/** Forgets what this person's card used to say, for a reader who does not want it kept. */
export async function forgetHistory(client: MatrixClient, person: Person): Promise<void> {
    const book = await writableBook(client);
    const id = canonicalOf(book, cardIdsOf(person));
    if (!id) return;
    const events = (await cardTimeline(client, book.roomId)).get(id) ?? [];
    // Every version but the one the card says now.
    const earlier = events.slice(0, -1).filter((event) => event.content.card);
    await redactAll(
        client,
        book.roomId,
        earlier.map((event) => event.eventId),
    );
}

/**
 * What changed between two versions of a card, as a list of field names.
 *
 * Names rather than values: the point on screen is "you changed their phone and their address on Tuesday",
 * and showing the values themselves would put a row of old phone numbers into a list the reader is
 * scanning. The values are in the revision for whoever opens it.
 */
export function changedFields(before: ContactCard, after: ContactCard): string[] {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)] as (keyof ContactCard)[]);
    const changed: string[] = [];
    for (const key of keys) {
        if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changed.push(key);
    }
    return changed;
}
