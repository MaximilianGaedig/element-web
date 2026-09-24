/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Everybody you know, once each, however you know them.
 *
 * The room list is a list of conversations, so a person you talk to on WhatsApp and Signal is two rows with
 * the same face, and a person whose number you have but have never messaged is no row at all. A contact list
 * is the other shape: one row per person, saying which networks they are on, so "call Alice" does not start
 * with remembering which app Alice is in.
 *
 * Three sources, in order of how much they know:
 *
 * - the bridges' own contact lists (`GET /v3/contacts`), which is the only source that knows people you have
 *   never messaged, and the only one that reliably carries phone numbers;
 * - the direct chats that already exist, which is what the reader thinks of as their contacts;
 * - links the reader made by hand, for the people no identifier ties together (account data, so they follow
 *   the account to every client rather than living in one browser).
 *
 * Merging is on published identifiers only (identity.ts). Same-name accounts are offered as a suggestion for
 * the reader to confirm, never merged: two people called Bob Carter are two people, and a wrong merge hides
 * one of them behind the other with nothing on screen to explain it.
 */

import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";

import { type BridgeLogin, type BridgePerson, askBridge, askEveryBridge, bridgeLogins } from "../bridge/provisioning";
import { getBridgeInfo, getBridgedDmUserId } from "../bridge/bridgeInfo";
import { type IdentityKey, identityKeys } from "./identity";
import DMRoomMap from "../DMRoomMap";

/** Where links the reader made by hand are kept, so they follow the account and not the browser. */
export const LINKS_EVENT_TYPE = "im.mxg.contact_links";

/** One person as one network knows them. */
export interface Account {
    /** The network's name, as its bridge gives it ("WhatsApp", "Signal"). */
    network: string;
    /** The ghost, when there is one: what to open a chat with. */
    mxid?: string;
    /** The network's own id, for asking the bridge to start a chat when there is no ghost yet. */
    remoteId: string;
    name?: string;
    avatarUrl?: string;
    /** The chat with them on this network, when one exists. */
    roomId?: string;
    keys: IdentityKey[];
    /** Which login answered, so a chat is started on the right account of the right network. */
    login?: BridgeLogin;
}

/** One person, however many networks that turns out to be. */
export interface Person {
    /** Stable enough to key a list on: the first identity key, else the first account's Matrix ID. */
    id: string;
    name: string;
    avatarUrl?: string;
    accounts: Account[];
    keys: IdentityKey[];
    /** The chats that exist with them, across networks. */
    rooms: string[];
}

/** Accounts that might be the same person but say nothing that proves it. */
export interface Suggestion {
    reason: "same name";
    people: Person[];
}

const nameOf = (account: Account): string => account.name?.trim() || account.mxid || account.remoteId;

/** What the bridges say is in your contacts, per network. */
async function contactsFromBridges(client: MatrixClient): Promise<Account[]> {
    const logins = bridgeLogins(client).filter((login) => login.can.listContacts);
    const answers = await askEveryBridge(client, logins, (login, signal) =>
        askBridge<{ contacts?: BridgePerson[] }>(client, login, "v3/contacts", undefined, signal),
    );
    const accounts: Account[] = [];
    for (const { login, answer } of answers) {
        for (const contact of answer.contacts ?? []) {
            accounts.push({
                network: login.network,
                mxid: contact.mxid,
                remoteId: contact.id,
                name: contact.name,
                avatarUrl: contact.avatar_url,
                roomId: contact.dm_room_mxid,
                keys: identityKeys(contact.identifiers),
                login,
            });
        }
    }
    return accounts;
}

/**
 * The people you already have a chat with, bridged or not.
 *
 * Read from the rooms rather than asked for, so this half works with no bridge reachable at all - and so the
 * list still has everybody the reader actually talks to when a network is down.
 */
function contactsFromChats(client: MatrixClient): Account[] {
    const accounts: Account[] = [];
    const dmMap = DMRoomMap.shared();
    for (const room of client.getVisibleRooms()) {
        const info = getBridgeInfo(room);
        const otherId = (info ? getBridgedDmUserId(room) : undefined) ?? dmMap.getUserIdForRoomId(room.roomId);
        if (!otherId || otherId === client.getSafeUserId()) continue;
        const member = room.getMember(otherId);
        accounts.push({
            network: info ? info.networkName : "Matrix",
            mxid: otherId,
            remoteId: otherId,
            name: member?.rawDisplayName ?? undefined,
            avatarUrl: member?.getMxcAvatarUrl() ?? undefined,
            roomId: room.roomId,
            // Identifiers come from the profile where the homeserver keeps extended fields; a chat alone
            // carries none, so these accounts merge only through a bridge's contact list or a manual link.
            keys: identityKeys(profileIdentifiers(room, otherId)),
        });
    }
    return accounts;
}

/**
 * Identifiers a ghost publishes in its profile.
 *
 * mautrix writes them as extended profile fields (MSC4133) when the homeserver supports it and
 * `matrix.ghost_extra_profile_info` is on, and they arrive on the member event, so they are readable here
 * without a profile fetch per person. Absent everywhere else, which is why this returns nothing rather than
 * guessing from the Matrix ID - see identity.ts on why guessing is worse than knowing nothing.
 */
function profileIdentifiers(room: Room, userId: string): string[] {
    const content = room.getMember(userId)?.events?.member?.getContent() as
        | { "identifiers"?: unknown; "com.beeper.identifiers"?: unknown }
        | undefined;
    const raw = content?.identifiers ?? content?.["com.beeper.identifiers"];
    return Array.isArray(raw) ? raw.filter((one): one is string => typeof one === "string") : [];
}

/** Links the reader made by hand: groups of Matrix IDs that are one person. */
export function manualLinks(client: MatrixClient): string[][] {
    const content = client.getAccountData(LINKS_EVENT_TYPE)?.getContent<{ links?: unknown }>();
    const links = Array.isArray(content?.links) ? content.links : [];
    return links
        .map((group) => (Array.isArray(group) ? group.filter((one): one is string => typeof one === "string") : []))
        .filter((group) => group.length > 1);
}

/** Records that these accounts are one person, folding in any link they were already part of. */
export async function linkAccounts(client: MatrixClient, mxids: string[]): Promise<void> {
    const existing = manualLinks(client);
    const touched = existing.filter((group) => group.some((one) => mxids.includes(one)));
    const untouched = existing.filter((group) => !touched.includes(group));
    const merged = [...new Set([...mxids, ...touched.flat()])];
    await client.setAccountData(LINKS_EVENT_TYPE, { links: [...untouched, merged] });
}

/** Undoes one link, leaving the accounts in it separate again. */
export async function unlinkAccount(client: MatrixClient, mxid: string): Promise<void> {
    const links = manualLinks(client)
        .map((group) => group.filter((one) => one !== mxid))
        .filter((group) => group.length > 1);
    await client.setAccountData(LINKS_EVENT_TYPE, { links });
}

/**
 * Groups accounts into people.
 *
 * Union-find over the things that prove two accounts are the same person: a shared identity key, the same
 * Matrix ID seen twice (a bridge's contact list and an existing chat), or a link the reader made.
 */
export function groupAccounts(accounts: Account[], links: string[][] = []): Person[] {
    const parent = new Map<number, number>();
    const find = (at: number): number => {
        let root = at;
        while (parent.get(root) !== undefined && parent.get(root) !== root) root = parent.get(root)!;
        parent.set(at, root);
        return root;
    };
    const union = (a: number, b: number): void => {
        const rootA = find(a);
        const rootB = find(b);
        if (rootA !== rootB) parent.set(rootB, rootA);
    };
    accounts.forEach((_, at) => parent.set(at, at));

    const byKey = new Map<string, number>();
    const join = (key: string, at: number): void => {
        const seen = byKey.get(key);
        if (seen === undefined) byKey.set(key, at);
        else union(seen, at);
    };
    accounts.forEach((account, at) => {
        for (const key of account.keys) join(`key:${key}`, at);
        if (account.mxid) join(`mxid:${account.mxid}`, at);
        for (const group of links) {
            if (account.mxid && group.includes(account.mxid)) join(`link:${group[0]}`, at);
        }
    });

    const groups = new Map<number, Account[]>();
    accounts.forEach((account, at) => {
        const root = find(at);
        groups.set(root, [...(groups.get(root) ?? []), account]);
    });

    return [...groups.values()]
        .map((group) => {
            const keys = [...new Set(group.flatMap((account) => account.keys))];
            // The name and face of whichever account has one, preferring an account that is in a chat:
            // that is the one the reader has seen before.
            const best = [...group].sort(
                (a, b) => Number(!!b.roomId) - Number(!!a.roomId) || Number(!!b.name) - Number(!!a.name),
            )[0];
            return {
                id: keys[0] ?? best.mxid ?? `${best.network}:${best.remoteId}`,
                name: nameOf(best),
                avatarUrl: group.find((account) => account.avatarUrl)?.avatarUrl,
                accounts: group,
                keys,
                rooms: [...new Set(group.map((account) => account.roomId).filter((id): id is string => !!id))],
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * People who share a name but nothing that proves they are the same person.
 *
 * Offered, not applied: the reader knows whether the Bob Carter on Signal is the Bob Carter on Messenger, and
 * this is the only place that knowledge can come from.
 */
export function sameNameSuggestions(people: Person[]): Suggestion[] {
    const byName = new Map<string, Person[]>();
    for (const person of people) {
        const name = person.name.trim().toLowerCase();
        if (!name) continue;
        byName.set(name, [...(byName.get(name) ?? []), person]);
    }
    return [...byName.values()]
        .filter((group) => group.length > 1)
        .map((group) => ({ reason: "same name" as const, people: group }));
}

/** Everybody you know, merged, with the links you made applied. */
export async function allPeople(client: MatrixClient): Promise<Person[]> {
    const [fromBridges, fromChats] = [await contactsFromBridges(client), contactsFromChats(client)];
    return groupAccounts([...fromBridges, ...fromChats], manualLinks(client));
}
