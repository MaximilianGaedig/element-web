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
import { type ContactDetail, type IdentityKey, identityDetails, identityKeys } from "./identity";
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
    /**
     * Everything the network published, for showing. Wider than `keys`, which is matching only: a username
     * cannot tie two accounts together but still belongs on the card. Absent where a network published
     * nothing, which is most of the accounts that come from a chat rather than an address book.
     */
    details?: ContactDetail[];
    /** The line the network shows to tell people of the same name apart, where it gives one. */
    context?: string;
    /** Which login answered, so a chat is started on the right account of the right network. */
    login?: BridgeLogin;
    /** Whether the network's own contact list holds them, rather than only a chat existing. */
    saved?: boolean;
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
    /** Everything every network published about them, once each. */
    details: ContactDetail[];
    /** Whether any network's contact list holds them, which is what "in your contacts" means here. */
    saved: boolean;
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
                details: identityDetails(contact.identifiers),
                context: contact.context,
                login,
                // This half of the list *is* the network's address book, so everyone in it is saved.
                saved: true,
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
async function contactsFromChats(client: MatrixClient): Promise<Account[]> {
    const dmMap = DMRoomMap.shared();
    const found: { room: Room; otherId: string }[] = [];
    for (const room of client.getVisibleRooms()) {
        const info = getBridgeInfo(room);
        const otherId = (info ? getBridgedDmUserId(room) : undefined) ?? dmMap?.getUserIdForRoomId(room.roomId);
        if (!otherId || otherId === client.getSafeUserId()) continue;
        found.push({ room, otherId });
    }
    /*
     * All the profiles at once, not one per row as the list is built: these are independent requests and
     * the list cannot be shown until the last of them anyway. Cached per ghost, so the rebuild that
     * follows every decision the reader makes costs nothing.
     */
    const identifiers = await Promise.all(found.map(({ otherId }) => profileIdentifiers(client, otherId)));
    return found.map(({ room, otherId }, at) => {
        const info = getBridgeInfo(room);
        const member = room.getMember(otherId);
        return {
            network: info ? info.networkName : "Matrix",
            mxid: otherId,
            remoteId: otherId,
            name: member?.rawDisplayName ?? undefined,
            avatarUrl: member?.getMxcAvatarUrl() ?? undefined,
            roomId: room.roomId,
            keys: identityKeys(identifiers[at]),
            details: identityDetails(identifiers[at]),
        };
    });
}

/** Where mautrix writes what a network knows somebody by, as an MSC4133 extended profile field. */
const IDENTIFIERS_KEY = "com.beeper.bridge.identifiers";

/**
 * Identifiers a ghost publishes, read from its profile.
 *
 * Not from the member event: that carries `displayname`, `avatar_url` and `membership` and nothing else,
 * which is why this found nothing for months while the bridges were publishing numbers all along. mautrix
 * writes them as extended profile fields (MSC4133) under `com.beeper.bridge.identifiers` - the
 * `com.beeper.bridge.` prefix matters, an unprefixed `identifiers` is never written by anything.
 *
 * A request per person, so the answers are kept: a contact list is rebuilt whenever the reader decides
 * something, and re-asking the server for facts that do not change would be a request per ghost per time.
 */
const profileCache = new Map<string, Promise<string[]>>();

async function profileIdentifiers(client: MatrixClient, userId: string): Promise<string[]> {
    const held = profileCache.get(userId);
    if (held) return held;
    const asked = client
        .getExtendedProfile(userId)
        .then((profile) => {
            const raw = (profile as Record<string, unknown>)[IDENTIFIERS_KEY];
            return Array.isArray(raw) ? raw.filter((one): one is string => typeof one === "string") : [];
        })
        // A ghost whose profile cannot be read is a person without published identifiers, not an error:
        // the list is built from several sources and one of them being quiet is ordinary.
        .catch(() => []);
    profileCache.set(userId, asked);
    return asked;
}

/** What the reader has decided about people the client could not merge on its own. */
interface Decisions {
    /** Groups of Matrix IDs the reader said are one person. */
    links?: unknown;
    /** Groups the reader said are *not* one person, so the suggestion stops being offered. */
    dismissed?: unknown;
    /** Names the reader gave people, against one of their Matrix IDs. */
    names?: unknown;
}

const decisions = (client: MatrixClient): Decisions =>
    client.getAccountData(LINKS_EVENT_TYPE)?.getContent<Decisions>() ?? {};

/** Groups of Matrix IDs out of stored account data, ignoring anything that is not one. */
function groupsIn(value: unknown): string[][] {
    return (Array.isArray(value) ? value : [])
        .map((group) => (Array.isArray(group) ? group.filter((one): one is string => typeof one === "string") : []))
        .filter((group) => group.length > 1);
}

/** Links the reader made by hand: groups of Matrix IDs that are one person. */
export function manualLinks(client: MatrixClient): string[][] {
    return groupsIn(decisions(client).links);
}

/** Suggestions the reader has turned down, so they are not offered again on the next opening. */
export function dismissedSuggestions(client: MatrixClient): string[][] {
    return groupsIn(decisions(client).dismissed);
}

/**
 * Writes the reader's decisions back, keeping whichever half is not being changed.
 *
 * Both halves go through their readers on the way out rather than the stored content being spread
 * straight back, so anything malformed that got in there is dropped rather than written again.
 */
async function decide(
    client: MatrixClient,
    next: { links?: string[][]; dismissed?: string[][]; names?: Record<string, string> },
): Promise<void> {
    await client.setAccountData(LINKS_EVENT_TYPE, {
        links: next.links ?? manualLinks(client),
        dismissed: next.dismissed ?? dismissedSuggestions(client),
        names: next.names ?? chosenNames(client),
    });
}

/**
 * Names the reader gave people, keyed by one of the person's Matrix IDs.
 *
 * Against a Matrix ID rather than the Person's own id: that id is the first identity key when there is
 * one and a Matrix ID when there is not, so it changes the day a bridge starts publishing numbers, and
 * a name the reader typed should not be lost to that.
 */
export function chosenNames(client: MatrixClient): Record<string, string> {
    const raw = decisions(client).names;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(
        Object.entries(raw as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string" && !!entry[1],
        ),
    );
}

/** The name the reader gave this person, if they gave one: the first of their accounts that has one. */
export function chosenName(client: MatrixClient, person: Person): string | undefined {
    const names = chosenNames(client);
    for (const account of person.accounts) {
        if (account.mxid && names[account.mxid]) return names[account.mxid];
    }
    return undefined;
}

/**
 * Records the name the reader gave this person, or clears it when handed nothing.
 *
 * Written against every one of their Matrix IDs, so the name survives the person being regrouped: a
 * merge that splits, or an identifier that arrives later, still finds it.
 */
export async function namePerson(client: MatrixClient, person: Person, name: string): Promise<void> {
    const names = { ...chosenNames(client) };
    for (const mxid of accountsOf([person])) {
        if (name) names[mxid] = name;
        else delete names[mxid];
    }
    await decide(client, { names });
}

/** Records that these accounts are one person, folding in any link they were already part of. */
export async function linkAccounts(client: MatrixClient, mxids: string[]): Promise<void> {
    const existing = manualLinks(client);
    const touched = existing.filter((group) => group.some((one) => mxids.includes(one)));
    const untouched = existing.filter((group) => !touched.includes(group));
    const merged = [...new Set([...mxids, ...touched.flat()])];
    await decide(client, { links: [...untouched, merged] });
}

/**
 * Undoes the links these accounts are part of, leaving them separate again.
 *
 * One write for however many accounts, because separating a person the reader merged means taking all of
 * them out of the group at once - doing it one at a time would put a half-split person on screen in between.
 * A group left holding fewer than two accounts is no longer a link and goes.
 */
export async function unlinkAccounts(client: MatrixClient, mxids: string[]): Promise<void> {
    const links = manualLinks(client)
        .map((group) => group.filter((one) => !mxids.includes(one)))
        .filter((group) => group.length > 1);
    await decide(client, { links });
}

/** Records that these accounts are not the same person, so the suggestion is not made again. */
export async function dismissSuggestion(client: MatrixClient, mxids: string[]): Promise<void> {
    await decide(client, { dismissed: [...dismissedSuggestions(client), [...mxids].sort()] });
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
                saved: group.some((account) => account.saved),
                // Once each, however many networks published it: the same number from three is one fact.
                details: [
                    ...new Map(
                        group.flatMap((account) => account.details ?? []).map((d) => [`${d.kind}:${d.value}`, d]),
                    ).values(),
                ],
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
export function sameNameSuggestions(people: Person[], dismissed: string[][] = []): Suggestion[] {
    const turnedDown = new Set(dismissed.map((group) => [...group].sort().join("\u0000")));
    const byName = new Map<string, Person[]>();
    for (const person of people) {
        const name = person.name.trim().toLowerCase();
        if (!name) continue;
        byName.set(name, [...(byName.get(name) ?? []), person]);
    }
    return [...byName.values()]
        .filter((group) => group.length > 1)
        .filter((group) => !turnedDown.has(accountsOf(group).sort().join("\u0000")))
        .map((group) => ({ reason: "same name" as const, people: group }));
}

/** Every Matrix ID under these people: what a link, or a refusal to link, is recorded against. */
export function accountsOf(people: Person[]): string[] {
    return [...new Set(people.flatMap((person) => person.accounts.map((account) => account.mxid)))].filter(
        (mxid): mxid is string => !!mxid,
    );
}

/** Everybody you know, merged, with the links you made applied. */
export async function allPeople(client: MatrixClient): Promise<Person[]> {
    const [fromBridges, fromChats] = await Promise.all([contactsFromBridges(client), contactsFromChats(client)]);
    return groupAccounts([...fromBridges, ...fromChats], manualLinks(client));
}
