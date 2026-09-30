/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * What the reader knows about somebody, as opposed to what the networks published.
 *
 * The networks say a name, a picture and sometimes a number; everything else about a person - their other
 * numbers, where they live, when their birthday is, who they are to you - is knowledge only the reader has,
 * and a contact list that cannot hold it is an index of chats rather than an address book.
 *
 * The fields are the ones a phone's address book has, because that is where these cards come from and go
 * back to: vCard is the interchange format (see vcard.ts) and its shape is what iOS, Android, Outlook and
 * every CardDAV server agree on. Stored in account data against every one of a person's Matrix IDs, the
 * same way their nickname and colour are, so it follows the account rather than the browser and survives
 * a merge being rebuilt in another order.
 *
 * What a network published is never written here. The card is the reader's own layer over it: the two are
 * shown together and only this one can be edited, so a bridge correcting a name can never quietly discard
 * something the reader typed.
 */

import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { type Person } from "./people";

/** Where the reader's own cards are kept. */
export const CARD_EVENT_TYPE = "im.mxg.contact_cards";

/**
 * A value with the label its owner gave it.
 *
 * The label is free text: iOS offers a list and lets you type your own, and vCard carries whatever it is
 * told, so a fixed set here would lose "ex-directory" or "dad's landline" on the way in and out.
 */
export interface Labelled {
    label: string;
    value: string;
}

/** A postal address, in the parts vCard's ADR splits it into. */
export interface Address {
    label: string;
    street?: string;
    city?: string;
    state?: string;
    postcode?: string;
    country?: string;
}

/** A date that matters, as written: a birthday may have no year, which is why this is not a timestamp. */
export interface DatedValue {
    label: string;
    /** `YYYY-MM-DD`, or `--MM-DD` for a day with no year, as vCard writes it. */
    date: string;
}

/** Somebody who is somebody to them: "mother", "spouse", "assistant". */
export interface Related {
    label: string;
    name: string;
}

/** A profile or a chat address on a service this client does not bridge. */
export interface Handle {
    service: string;
    handle: string;
    url?: string;
}

/**
 * Everything a card can hold, which is everything a phone's address book holds.
 *
 * Names are kept in parts rather than as one string because that is how they sort, how they are spoken,
 * and how every other address book stores them - joining them early would mean guessing where to split
 * them again on the way out.
 */
export interface ContactCard {
    prefix?: string;
    firstName?: string;
    phoneticFirst?: string;
    middleName?: string;
    phoneticMiddle?: string;
    lastName?: string;
    phoneticLast?: string;
    suffix?: string;
    nickname?: string;
    /** Maiden name and the like, which vCard has no field for and iOS keeps as a previous family name. */
    previousName?: string;

    jobTitle?: string;
    department?: string;
    company?: string;

    phones?: Labelled[];
    emails?: Labelled[];
    urls?: Labelled[];
    addresses?: Address[];

    /** `YYYY-MM-DD` or `--MM-DD`. */
    birthday?: string;
    /** Anniversaries and anything else dated. */
    dates?: DatedValue[];

    related?: Related[];
    social?: Handle[];
    /** Chat addresses on services with no bridge here: Skype, XMPP, whatever the card came with. */
    messaging?: Handle[];

    notes?: string;

    /**
     * A picture the reader chose, as an mxc: URI.
     *
     * Uploaded to the reader's own media rather than kept as data in account data: a photo inlined there
     * would be sent to every device on every sync, and account data is not the place for a megabyte per
     * contact. Shown in front of whatever the networks publish, because a picture the reader picked is the
     * one they mean.
     */
    photoUrl?: string;

    /**
     * The lines of an imported vCard this client does not understand, kept verbatim.
     *
     * A card from another address book carries that address book's own properties, and dropping them would
     * make exporting a contact that came from elsewhere a quiet way to strip half of what its own app looks
     * for. They are never shown and never edited - only carried - so nothing here has to understand them.
     */
    extra?: string[];
}

/** The labels a phone offers, which are also the ones vCard writes without needing a custom type. */
export const PHONE_LABELS = ["mobile", "home", "work", "main", "home fax", "work fax", "pager", "other"];
export const EMAIL_LABELS = ["home", "work", "school", "other"];
export const URL_LABELS = ["homepage", "home", "work", "other"];
export const ADDRESS_LABELS = ["home", "work", "other"];
export const DATE_LABELS = ["anniversary", "other"];
export const RELATED_LABELS = [
    "mother",
    "father",
    "parent",
    "brother",
    "sister",
    "child",
    "friend",
    "spouse",
    "partner",
    "assistant",
    "manager",
    "other",
];

interface Stored {
    /** One card per Matrix ID; several IDs of one person point at the same card. */
    cards?: Record<string, ContactCard>;
}

const stored = (client: MatrixClient): Stored => client.getAccountData(CARD_EVENT_TYPE)?.getContent<Stored>() ?? {};

/** The card the reader has written for this person, if they have written one. */
export function cardFor(client: MatrixClient, person: Person): ContactCard | undefined {
    const cards = stored(client).cards ?? {};
    for (const account of person.accounts) {
        const found = account.mxid ? cards[account.mxid] : undefined;
        if (found) return found;
    }
    return undefined;
}

/** Whether a card says anything at all, so an empty one can be dropped rather than stored. */
export function isEmpty(card: ContactCard): boolean {
    return Object.values(card).every(
        (value) => value === undefined || value === "" || (Array.isArray(value) && value.length === 0),
    );
}

/**
 * Writes the card against every one of their Matrix IDs, or clears it when it says nothing.
 *
 * Against all of them for the same reason a nickname is written that way: one person is several accounts,
 * and a card against only the first would be lost the moment the merge was rebuilt in another order.
 */
export async function saveCard(client: MatrixClient, person: Person, card: ContactCard): Promise<void> {
    const cards = { ...stored(client).cards };
    const empty = isEmpty(card);
    for (const account of person.accounts) {
        if (!account.mxid) continue;
        if (empty) delete cards[account.mxid];
        else cards[account.mxid] = card;
    }
    await client.setAccountData(CARD_EVENT_TYPE, { cards });
}

/** Every card the reader has written, for handing the whole address book to something else. */
export const allCards = (client: MatrixClient): Record<string, ContactCard> => stored(client).cards ?? {};

/** The whole name, in the order it is written, from whichever parts are filled in. */
export function fullName(card: ContactCard): string {
    return [card.prefix, card.firstName, card.middleName, card.lastName, card.suffix]
        .filter((part) => part && part.trim())
        .join(" ");
}
