/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Tags on people: the reader's own filing.
 *
 * Not the rooms they are in - those are shared with everyone in them and are a fact about the network. A
 * tag is theirs: "family", "the band", "work", made up by them and seen by nobody else. Kept in account
 * data with the links, the nicknames and the colours, for the same reason.
 *
 * Membership is by account, and a person is several of them, so tagging somebody tags all their accounts:
 * a tag that held one account of a merged person would lose them the moment the merge was rebuilt in
 * another order, and would show them twice if there were no merge at all.
 */

import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { type Person, accountId } from "./people";

export const TAGS_EVENT_TYPE = "im.mxg.contact_tags";

export interface ContactTag {
    /** Stable across renames, so a tag can be renamed without emptying it. */
    id: string;
    name: string;
    /** The Matrix IDs in it. */
    members: string[];
}

interface Stored {
    tags?: ContactTag[];
}

const read = (client: MatrixClient): ContactTag[] =>
    (client.getAccountData(TAGS_EVENT_TYPE)?.getContent<Stored>()?.tags ?? []).filter(
        (tag): tag is ContactTag => !!tag && typeof tag.id === "string" && typeof tag.name === "string",
    );

export const contactTags = (client: MatrixClient): ContactTag[] => read(client);

const write = (client: MatrixClient, tags: ContactTag[]): Promise<unknown> =>
    client.setAccountData(TAGS_EVENT_TYPE, { tags });

/** A new, empty tag. The id is generated rather than the name, so renaming keeps the members. */
export async function addTag(client: MatrixClient, name: string): Promise<void> {
    const id = `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    await write(client, [...read(client), { id, name: name.trim(), members: [] }]);
}

export async function renameTag(client: MatrixClient, id: string, name: string): Promise<void> {
    await write(
        client,
        read(client).map((tag) => (tag.id === id ? { ...tag, name: name.trim() } : tag)),
    );
}

export async function removeTag(client: MatrixClient, id: string): Promise<void> {
    await write(
        client,
        read(client).filter((tag) => tag.id !== id),
    );
}

/** Whether every account of theirs is in the tag, which is what being in it means for a merged person. */
export function inTag(tag: ContactTag, person: Person): boolean {
    const theirs = person.accounts.map(accountId);
    return theirs.length > 0 && theirs.every((id) => tag.members.includes(id));
}

/** Puts somebody in a tag or takes them out of it, all of their accounts together. */
export async function setInTag(client: MatrixClient, id: string, person: Person, member: boolean): Promise<void> {
    const theirs = person.accounts.map(accountId);
    await write(
        client,
        read(client).map((tag) => {
            if (tag.id !== id) return tag;
            const members = new Set(tag.members);
            for (const id of theirs) {
                if (member) members.add(id);
                else members.delete(id);
            }
            return { ...tag, members: [...members] };
        }),
    );
}

/** The people in a tag, in the order the tag itself was built - which is the order they are shown. */
export const peopleTagged = (tag: ContactTag, people: readonly Person[]): Person[] =>
    people.filter((person) => person.accounts.some((account) => tag.members.includes(accountId(account))));
