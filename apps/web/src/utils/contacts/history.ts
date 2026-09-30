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
 * So every save keeps what was there before, with when it happened and what did it. Kept per person and
 * capped, because this is account data and account data is synced to every device: a card's whole past is
 * worth a few kilobytes, not a few megabytes.
 */

import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { type ContactCard } from "./card";
import { type Person } from "./people";

export const HISTORY_EVENT_TYPE = "im.mxg.contact_history";

/** What changed a card, so the record says why it looks different rather than only that it does. */
export type EditSource = "edit" | "import" | "merge" | "restore";

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
}

/** How many revisions a person keeps. Enough to undo a bad afternoon, not enough to bloat every sync. */
const KEEP = 20;

interface Stored {
    /** Revisions per Matrix ID, newest first. */
    history?: Record<string, Revision[]>;
}

const stored = (client: MatrixClient): Stored => client.getAccountData(HISTORY_EVENT_TYPE)?.getContent<Stored>() ?? {};

/** Every one of their Matrix IDs, which is what the record is kept against. */
const idsOf = (person: Person): string[] =>
    person.accounts.map((account) => account.mxid).filter((mxid): mxid is string => !!mxid);

/** What this person's card has said before now, newest first. */
export function historyFor(client: MatrixClient, person: Person): Revision[] {
    const history = stored(client).history ?? {};
    for (const mxid of idsOf(person)) {
        const found = history[mxid];
        if (found?.length) return found;
    }
    return [];
}

/**
 * Records what the card said before a change is written.
 *
 * Called with the *previous* card, before the new one is saved. A change that changes nothing is not
 * recorded: saving a form without touching it should not push the real history out of the window.
 */
export async function recordRevision(
    client: MatrixClient,
    person: Person,
    was: ContactCard | undefined,
    source: EditSource,
): Promise<void> {
    if (!was) return;
    const history = { ...stored(client).history };
    const ids = idsOf(person);
    const current = ids.map((mxid) => history[mxid]).find((one) => one?.length) ?? [];
    if (current[0] && JSON.stringify(current[0].was) === JSON.stringify(was)) return;
    const next = [{ ts: Date.now(), source, was }, ...current].slice(0, KEEP);
    for (const mxid of ids) history[mxid] = next;
    await client.setAccountData(HISTORY_EVENT_TYPE, { history });
}

/** Forgets what this person's card used to say, for a reader who does not want it kept. */
export async function forgetHistory(client: MatrixClient, person: Person): Promise<void> {
    const history = { ...stored(client).history };
    for (const mxid of idsOf(person)) delete history[mxid];
    await client.setAccountData(HISTORY_EVENT_TYPE, { history });
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
