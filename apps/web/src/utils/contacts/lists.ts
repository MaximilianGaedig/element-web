/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Lists of people, which a phone's address book calls Lists and used to call Groups.
 *
 * Not the rooms they are in - those are shared with everyone in them and are a fact about the network.
 * A list is the reader's own filing: "family", "the band", "work", made up by them and seen by nobody
 * else. Kept in account data with the links, the nicknames and the colours, for the same reason.
 *
 * Membership is by Matrix ID, and a person is several of them, so adding somebody adds all their accounts:
 * a list that held one account of a merged person would lose them the moment the merge was rebuilt in
 * another order, and would show them twice if it were not for the merge at all.
 */

import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { type Person } from "./people";

export const LISTS_EVENT_TYPE = "im.mxg.contact_lists";

export interface ContactList {
    /** Stable across renames, so a list can be renamed without emptying it. */
    id: string;
    name: string;
    /** The Matrix IDs in it. */
    members: string[];
}

interface Stored {
    lists?: ContactList[];
}

const read = (client: MatrixClient): ContactList[] =>
    (client.getAccountData(LISTS_EVENT_TYPE)?.getContent<Stored>()?.lists ?? []).filter(
        (list): list is ContactList => !!list && typeof list.id === "string" && typeof list.name === "string",
    );

export const contactLists = (client: MatrixClient): ContactList[] => read(client);

const write = (client: MatrixClient, lists: ContactList[]): Promise<unknown> =>
    client.setAccountData(LISTS_EVENT_TYPE, { lists });

/** A new, empty list. The id is generated rather than the name, so renaming keeps the members. */
export async function addList(client: MatrixClient, name: string): Promise<void> {
    const id = `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    await write(client, [...read(client), { id, name: name.trim(), members: [] }]);
}

export async function renameList(client: MatrixClient, id: string, name: string): Promise<void> {
    await write(
        client,
        read(client).map((list) => (list.id === id ? { ...list, name: name.trim() } : list)),
    );
}

export async function removeList(client: MatrixClient, id: string): Promise<void> {
    await write(
        client,
        read(client).filter((list) => list.id !== id),
    );
}

/** Whether every account of theirs is in the list, which is what being in it means for a merged person. */
export function inList(list: ContactList, person: Person): boolean {
    const theirs = person.accounts.map((account) => account.mxid).filter((mxid): mxid is string => !!mxid);
    return theirs.length > 0 && theirs.every((mxid) => list.members.includes(mxid));
}

/** Puts somebody in a list or takes them out of it, all of their accounts together. */
export async function setInList(client: MatrixClient, id: string, person: Person, member: boolean): Promise<void> {
    const theirs = person.accounts.map((account) => account.mxid).filter((mxid): mxid is string => !!mxid);
    await write(
        client,
        read(client).map((list) => {
            if (list.id !== id) return list;
            const members = new Set(list.members);
            for (const mxid of theirs) {
                if (member) members.add(mxid);
                else members.delete(mxid);
            }
            return { ...list, members: [...members] };
        }),
    );
}

/** The people in a list, in the order the list itself was built - which is the order they are shown. */
export const peopleIn = (list: ContactList, people: readonly Person[]): Person[] =>
    people.filter((person) => person.accounts.some((account) => account.mxid && list.members.includes(account.mxid)));
