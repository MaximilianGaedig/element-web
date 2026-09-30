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

import { CARD_EVENT_TYPE, type ContactCard, cardFor, fullName } from "./card";
import { recordRevision } from "./history";
import { readKey } from "./identity";
import { type Person } from "./people";

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

/** Where a card with nobody to attach to is kept, so it is still in the address book. */
const unmatchedKey = (card: ContactCard): string => `vcard:${fullName(card) || card.nickname || keysOf(card)[0] || ""}`;

/**
 * Writes each card against whoever it turned out to be.
 *
 * One write for the lot rather than one per card: account data is a whole document, and saving it per
 * contact would mean an import of two hundred people making two hundred round trips, each overwriting the
 * last. Returns how many were taken in, which is what the reader is told.
 */
export async function importCards(client: MatrixClient, cards: ContactCard[], people: Person[]): Promise<number> {
    const held = client.getAccountData(CARD_EVENT_TYPE)?.getContent<{ cards?: Record<string, ContactCard> }>() ?? {};
    const next: Record<string, ContactCard> = { ...held.cards };

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
        if (match) {
            // What the card said before the import landed on it, so a wrong match can be undone.
            await recordRevision(client, match, cardFor(client, match), "import");
            // Against every one of their accounts, as the reader's own edits are.
            for (const account of match.accounts) if (account.mxid) next[account.mxid] = card;
        } else {
            next[unmatchedKey(card)] = card;
        }
        taken++;
    }
    await client.setAccountData(CARD_EVENT_TYPE, { cards: next });
    return taken;
}
