/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Bringing an address book in.
 *
 * A card from a phone is matched to somebody already here by something both sides can agree on - a phone
 * number or an email address, normalised the same way the merging is (see identity.ts) - and written
 * against that person, so the imported details land on the contact the reader already talks to rather than
 * beside it as a second copy.
 *
 * A card that matches nobody is kept anyway, under the Matrix IDs it does not have: it is stored against a
 * key of its own so the reader keeps the number they imported even though no chat exists yet. That is what
 * an address book is for - most of the people in one are not people you are currently messaging.
 */

import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { type ContactCard, cardIdsOf, cardLabel, fullName } from "./card";
import { readKey } from "./identity";
import { type Person } from "./people";
import { type Book, type Write, applyWrites, commit, planSave, writableBook } from "./addressBook";
import { photosToMedia } from "./photos";

/** A phone number or an address, in the form the matching uses. */
function keysOf(card: ContactCard): string[] {
    const keys: string[] = [];
    for (const phone of card.phones ?? []) {
        const digits = phone.value.replace(/[^\d+]/g, "");
        if (digits.length >= 6) keys.push(`tel:${digits.startsWith("+") ? digits : `+${digits}`}`);
    }
    for (const email of card.emails ?? []) keys.push(`mailto:${email.value.trim().toLowerCase()}`);
    return keys;
}

/**
 * Where a card with nobody to attach to is kept, so it is still in the address book. A card with nothing
 * to name it by is keyed by its content, so that two such cards don't share the bare key "vcard:" (one
 * overwriting the other) and importing the same file again still finds the same card.
 */
const unmatchedKey = (card: ContactCard): string =>
    `vcard:${fullName(card) || card.nickname || keysOf(card)[0] || cardLabel(card) || `#${contentHash(card)}`}`;

/** A short stable hash of a card's content (FNV-1a over its JSON), for keying a card with no name. */
function contentHash(card: ContactCard): string {
    let hash = 0x811c9dc5;
    for (const ch of JSON.stringify(card)) {
        hash = Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0;
    }
    return hash.toString(36);
}

/**
 * Writes each card against whoever it turned out to be.
 *
 * A state event per card in the address book room, planned all together first so each card's plan sees the
 * ones before it, then sent a few at a time. A card landing on somebody who already had one keeps what it
 * replaced as an earlier version marked "import", so a wrong match can be undone. Each card's photo goes to
 * media on the way (photos.ts). Returns how many were taken in, which is what the reader is told.
 */
export async function importCards(client: MatrixClient, cards: ContactCard[], people: Person[]): Promise<number> {
    const book = await writableBook(client);
    // Planned against a copy, which takes each plan as it is made; the real book follows the sends.
    const planned: Book = { ...book, cards: new Map(book.cards), aliases: new Map(book.aliases) };
    const writes: Write[] = [];
    const uploaded = new Map<string, Promise<string>>();
    const plan = (ids: string[], card: ContactCard): void => {
        const next = planSave(planned, ids, card, "import");
        applyWrites(planned, next);
        writes.push(...next);
    };

    /* Everyone already here, by every identifier they publish, so a card can find them. */
    const byKey = new Map<string, Person>();
    for (const person of people) {
        for (const key of person.keys) byKey.set(readKey(key).toLowerCase(), person);
        for (const detail of person.details) byKey.set(detail.value.trim().toLowerCase(), person);
    }

    let taken = 0;
    for (const card of cards) {
        const match = keysOf(card)
            .map((key) => byKey.get(readKey(key).toLowerCase()))
            .find((person): person is Person => !!person);
        const stored = await photosToMedia(client, card, uploaded);
        // Against every one of their accounts, as the reader's own edits are; keyed by what it says otherwise.
        if (match && cardIdsOf(match).length) plan(cardIdsOf(match), stored);
        else plan([unmatchedKey(card)], stored);
        taken++;
    }
    await commit(client, book, writes);
    return taken;
}
