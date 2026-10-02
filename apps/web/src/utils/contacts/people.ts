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
import { getBridgeBots, getBridgeInfo, getBridgedDmUserId } from "../bridge/bridgeInfo";
import { type ContactDetail, type IdentityKey, identityDetails, identityKeys } from "./identity";
import DMRoomMap from "../DMRoomMap";
import { type ContactCard, allCards, cardFor, cardLabel, fullName } from "./card";
import { cardFromProfile } from "./publish";

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
    /**
     * What the network published, as published: `tel:+48...`, `telegram:ada`.
     *
     * Kept beside `keys` and `details` rather than derived from either, because a link into the network's
     * own app is built from the raw forms (see utils/contacts/deepLinks.ts) - `keys` is narrowed to what
     * can match two accounts and `details` is shaped for showing.
     */
    identifiers?: string[];
    /** Which login answered, so a chat is started on the right account of the right network. */
    login?: BridgeLogin;
    /** Whether the network's own contact list holds them, rather than only a chat existing. */
    saved?: boolean;
    /**
     * What this account published about itself on its Matrix profile.
     *
     * Shown where the reader has written nothing of their own: theirs always wins, because a profile
     * changing must not overwrite what somebody typed.
     */
    publishedCard?: ContactCard;
    /** A bot, as its network or its bridge says: a Telegram bot, or the bridge's own bot account. */
    bot?: boolean;
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
    /** A bot rather than a person: a network's bot, or a bridge's own. Kept out of the list by default. */
    bot?: boolean;
}

/** Accounts that might be the same person but say nothing that proves it. */
export interface Suggestion {
    reason: "same name";
    people: Person[];
}

/**
 * Whose name a merged person goes by, best first. As in a phone's contacts app, the name in the reader's
 * address book wins over what a network calls them: an imported contact first, then a network's own
 * address book (a bridge's contact list, i.e. the name saved on the phone), then the name in a chat.
 */
function nameRank(account: Account): number {
    if (!account.name?.trim()) return 4;
    if (account.network === "Contacts") return 0;
    if (account.saved) return 1;
    if (account.roomId) return 2;
    return 3;
}

/** Their name, or failing any, the number or handle they are known by, and only then the bare ID. */
const nameOf = (account: Account): string =>
    account.name?.trim() || account.details?.[0]?.value || account.mxid || account.remoteId;

/** What the bridges say is in your contacts, per network. */
/** How long the bridges' address books are reused before being asked for again. */
const BRIDGE_CONTACTS_FRESH_MS = 5 * 60 * 1000;
const bridgeContactsCache = new WeakMap<MatrixClient, { at: number; accounts: Promise<Account[]> }>();

/**
 * The bridges' address books, asked for at most every few minutes.
 *
 * Every change the reader makes here - a merge, a dismissed suggestion - rebuilds the list, and asking every
 * bridge again for each one made each merge a round trip to every network and the list flash while it
 * waited. `fresh` asks regardless, for opening the view, when the reader expects the networks' latest.
 */
function bridgeContacts(client: MatrixClient, fresh: boolean): Promise<Account[]> {
    const held = bridgeContactsCache.get(client);
    if (!fresh && held && Date.now() - held.at < BRIDGE_CONTACTS_FRESH_MS) return held.accounts;
    const accounts = contactsFromBridges(client);
    bridgeContactsCache.set(client, { at: Date.now(), accounts });
    // A failed ask is not kept: the next build asks again rather than reusing the failure.
    accounts.catch(() => bridgeContactsCache.delete(client));
    return accounts;
}

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
                identifiers: contact.identifiers,
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
async function contactsFromChats(client: MatrixClient, profiles: boolean): Promise<Account[]> {
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
    /*
     * Waiting for the profiles is what made the list slow to appear: one request per person, and the first
     * name could not be drawn until the last of them answered. Asked for only when the caller wants them,
     * so the list can be built from the rooms at once and built again when the answers are in.
     */
    const facts = profiles
        ? await Promise.all(found.map(({ otherId }) => profileFacts(client, otherId)))
        : found.map(() => NOTHING_PUBLISHED);
    return found.map(({ room, otherId }, at) => {
        const info = getBridgeInfo(room);
        const member = room.getMember(otherId);
        const published = facts[at];
        return {
            // The profile's own answer first: a network that publishes no identifiers - Discord - still says
            // which network it is and which account, so its rows read as an account rather than a bare mxid.
            network: published.network ?? (info ? info.networkName : "Matrix"),
            mxid: otherId,
            remoteId: published.remoteId ?? otherId,
            /*
             * The member event first, then the profile, then the chat's own name. Members are loaded lazily,
             * so for most chats the other person's member event is not in the client at all - and the name
             * fell back to the bare Matrix ID. The profile carries the same display name, and a DM's name is
             * the person's name when the bridge set one.
             */
            name:
                nonId(member?.rawDisplayName, otherId) ??
                nonId(published.displayName, otherId) ??
                nonId(client.getUser(otherId)?.displayName, otherId) ??
                (info && getBridgedDmUserId(room) === otherId ? nonId(room.name, otherId) : undefined),
            avatarUrl:
                member?.getMxcAvatarUrl() ?? published.avatarUrl ?? client.getUser(otherId)?.avatarUrl ?? undefined,
            roomId: room.roomId,
            keys: identityKeys(published.identifiers),
            details: identityDetails(published.identifiers),
            identifiers: published.identifiers,
            publishedCard: published.published,
            // The bridge's own bot needs no profile to be known: the room's bridge event names it.
            bot: published.bot || getBridgeBots(room).has(otherId) || undefined,
        };
    });
}

/**
 * Somebody there is no chat with: a member of a group, opened from its member list.
 *
 * They are a person all the same, and often one already known - the same number on another network, a
 * card in the address book. What their profile publishes is what ties them to the rest of themselves, so
 * it is asked for like any chat partner's.
 */
async function accountOfUser(client: MatrixClient, userId: string): Promise<Account> {
    const published = await profileFacts(client, userId);
    const user = client.getUser(userId);
    return {
        network: published.network ?? "Matrix",
        mxid: userId,
        remoteId: published.remoteId ?? userId,
        name: nonId(published.displayName, userId) ?? nonId(user?.displayName, userId),
        avatarUrl: published.avatarUrl ?? user?.avatarUrl ?? undefined,
        keys: identityKeys(published.identifiers),
        details: identityDetails(published.identifiers),
        identifiers: published.identifiers,
        publishedCard: published.published,
        bot: published.bot || undefined,
    };
}

/**
 * The network an account is on, as its profile says it, or undefined for a Matrix account: what a face
 * is badged with where there is no chat to read the network from. Cached with the rest of the profile.
 */
export async function networkOfUser(client: MatrixClient, userId: string): Promise<string | undefined> {
    return (await profileFacts(client, userId)).network;
}

/** Where mautrix writes what a network knows about a ghost, as MSC4133 extended profile fields. */
const IDENTIFIERS_KEY = "com.beeper.bridge.identifiers";
const NETWORK_KEY = "com.beeper.bridge.network";
const REMOTE_ID_KEY = "com.beeper.bridge.remote_id";
/** Set on a network's bots (a Telegram bot) and on the bridge's own bot, respectively. */
const NETWORK_BOT_KEY = "com.beeper.bridge.is_network_bot";
const BRIDGE_BOT_KEY = "com.beeper.bridge.is_bridge_bot";

/** What a ghost's profile says about it, beyond the display name and avatar every member event carries. */
interface ProfileFacts {
    identifiers: string[];
    network?: string;
    remoteId?: string;
    /** What the account published about itself, where it published anything. */
    published?: ContactCard;
    bot?: boolean;
    displayName?: string;
    avatarUrl?: string;
}

/** A name that is a name, not the Matrix ID standing in for one (which is what a missing name renders as). */
function nonId(name: string | undefined | null, mxid: string): string | undefined {
    const trimmed = name?.trim();
    return trimmed && trimmed !== mxid && trimmed !== mxid.slice(1).split(":")[0] ? trimmed : undefined;
}

const strings = (raw: unknown): string[] =>
    Array.isArray(raw) ? raw.filter((one): one is string => typeof one === "string") : [];

const text = (raw: unknown): string | undefined => (typeof raw === "string" && raw.length > 0 ? raw : undefined);

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
const profileCache = new Map<string, Promise<ProfileFacts>>();

/** How many people's profile facts are held, for the memory report. */
export const profileFactsKept = (): number => profileCache.size;

const NOTHING_PUBLISHED: ProfileFacts = { identifiers: [] };

async function profileFacts(client: MatrixClient, userId: string): Promise<ProfileFacts> {
    const held = profileCache.get(userId);
    if (held) return held;
    const asked = client
        .getExtendedProfile(userId)
        .then((profile) => ({
            identifiers: strings(profile[IDENTIFIERS_KEY]),
            network: text(profile[NETWORK_KEY]),
            remoteId: text(profile[REMOTE_ID_KEY]),
            /*
             * What a Matrix account publishes about itself, read off the same profile: this client can
             * publish a card to a profile, so it reads one back - otherwise the publishing half would only
             * ever be seen by other software.
             */
            published: cardFromProfile(profile),
            bot: profile[NETWORK_BOT_KEY] === true || profile[BRIDGE_BOT_KEY] === true,
            displayName: text(profile.displayname),
            avatarUrl: text(profile.avatar_url),
        }))
        // A ghost whose profile cannot be read is a person without published identifiers, not an error:
        // the list is built from several sources and one of them being quiet is ordinary.
        .catch(() => NOTHING_PUBLISHED);
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
    /** Accounts the reader took out of a person the client had put together by itself. */
    apart?: unknown;
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
 * Accounts the reader said are not who the client grouped them with.
 *
 * A manual link is undone by removing it. A grouping the client made itself - two accounts publishing the
 * same number - has nothing to remove, so the account is remembered here instead and what it publishes is
 * no longer taken as proof of who it is. A shared number is strong evidence and still not proof: a number
 * changes hands, and a family shares one.
 */
export function keptApart(client: MatrixClient): string[] {
    const raw = decisions(client).apart;
    return Array.isArray(raw) ? raw.filter((one): one is string => typeof one === "string") : [];
}

/**
 * Writes the reader's decisions back, keeping whichever half is not being changed.
 *
 * Both halves go through their readers on the way out rather than the stored content being spread
 * straight back, so anything malformed that got in there is dropped rather than written again.
 */
async function decide(
    client: MatrixClient,
    next: { links?: string[][]; dismissed?: string[][]; names?: Record<string, string>; apart?: string[] },
): Promise<void> {
    await client.setAccountData(LINKS_EVENT_TYPE, {
        links: next.links ?? manualLinks(client),
        dismissed: next.dismissed ?? dismissedSuggestions(client),
        names: next.names ?? chosenNames(client),
        apart: next.apart ?? keptApart(client),
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
    // Saying they are one person is the later word on an account that had been taken out of one.
    const apart = keptApart(client).filter((one) => !merged.includes(one));
    await decide(client, { links: [...untouched, merged], apart });
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

/**
 * Takes one account out of the person it is shown under, however it got there.
 *
 * Out of any link the reader made, and kept apart from whoever the client would group it with by what it
 * publishes - the reader does not know which of the two put it there, and should not have to.
 */
export async function takeOutAccount(client: MatrixClient, id: string): Promise<void> {
    const links = manualLinks(client)
        .map((group) => group.filter((one) => one !== id))
        .filter((group) => group.length > 1);
    await decide(client, { links, apart: [...new Set([...keptApart(client), id])] });
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
/**
 * One account per account, however many places described it.
 *
 * The same account arrives from more than one source - the chat with them, and the network's own address
 * book - and grouping put both copies into one person, so somebody showed Telegram twice. Copies are the
 * same account when they share a Matrix ID, or a network and that network's id for them (an address book
 * can know somebody without a ghost). What each copy knew is pooled: the chat from one, the identifiers
 * and "saved" from the other.
 */
export function mergeSameAccounts(accounts: Account[]): Account[] {
    const merged: Account[] = [];
    const byIdentity = new Map<string, Account>();
    const identities = (account: Account): string[] =>
        [
            account.mxid && `mxid:${account.mxid}`,
            // A chat account with nothing published uses its Matrix ID as its remote id; that is not a
            // network id, and matching on it would be matching the Matrix ID twice.
            account.remoteId && account.remoteId !== account.mxid && `remote:${account.network}:${account.remoteId}`,
        ].filter((identity): identity is string => !!identity);

    for (const account of accounts) {
        const same = identities(account)
            .map((identity) => byIdentity.get(identity))
            .find((found): found is Account => !!found);
        if (!same) {
            const copy = { ...account };
            merged.push(copy);
            for (const identity of identities(copy)) byIdentity.set(identity, copy);
            continue;
        }
        Object.assign(same, {
            mxid: same.mxid ?? account.mxid,
            remoteId: same.remoteId && same.remoteId !== same.mxid ? same.remoteId : account.remoteId,
            // The name saved in the network's address book (the reader's phone contact) wins, as in a
            // phone's contacts app; otherwise the name in the chat, the one the reader has seen.
            name:
                (same.saved ? same.name : undefined) ??
                (account.saved ? account.name : undefined) ??
                (same.roomId ? (same.name ?? account.name) : (account.name ?? same.name)),
            avatarUrl: same.avatarUrl ?? account.avatarUrl,
            roomId: same.roomId ?? account.roomId,
            keys: [...new Set([...same.keys, ...account.keys])],
            details: pool(same.details, account.details, (d) => `${d.kind}:${d.value}`),
            identifiers: pool(same.identifiers, account.identifiers, (id) => id),
            context: same.context ?? account.context,
            login: same.login ?? account.login,
            saved: same.saved || account.saved,
            publishedCard: same.publishedCard ?? account.publishedCard,
            bot: same.bot || account.bot,
        });
        for (const identity of identities(same)) byIdentity.set(identity, same);
    }
    return merged;
}

function pool<T>(a: T[] | undefined, b: T[] | undefined, key: (item: T) => string): T[] | undefined {
    if (!a && !b) return undefined;
    return [...new Map([...(a ?? []), ...(b ?? [])].map((item) => [key(item), item])).values()];
}

export function groupAccounts(described: Account[], links: string[][] = [], apart: string[] = []): Person[] {
    const accounts = mergeSameAccounts(described);
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
        // An account the reader took out of a person is not put back by a number it shares with them.
        if (!apart.includes(accountId(account))) for (const key of account.keys) join(`key:${key}`, at);
        if (account.mxid) join(`mxid:${account.mxid}`, at);
        for (const group of links) {
            if (group.includes(accountId(account))) join(`link:${group[0]}`, at);
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
            // The face of whichever account has one, preferring an account that is in a chat: that is the
            // one the reader has seen before.
            const best = [...group].sort(
                (a, b) => Number(!!b.roomId) - Number(!!a.roomId) || Number(!!b.name) - Number(!!a.name),
            )[0];
            return {
                id: keys[0] ?? best.mxid ?? `${best.network}:${best.remoteId}`,
                name: nameOf([...group].sort((a, b) => nameRank(a) - nameRank(b))[0]),
                avatarUrl: group.find((account) => account.avatarUrl)?.avatarUrl,
                accounts: group,
                keys,
                rooms: [...new Set(group.map((account) => account.roomId).filter((id): id is string => !!id))],
                saved: group.some((account) => account.saved),
                bot: group.some((account) => account.bot) || undefined,
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

/**
 * What a link, or a refusal to link, is recorded against.
 *
 * A Matrix ID where there is one, and the account's own key where there is not. Recording links by Matrix
 * ID alone meant an imported contact could never be merged by hand: a vCard has no Matrix ID, so the one
 * merge a reader most wants to make - this card I imported is that WhatsApp contact - was the one the list
 * refused. Its own key is just as stable and just as unique.
 */
export const accountId = (account: Account): string => account.mxid ?? account.remoteId;

export function accountsOf(people: Person[]): string[] {
    return [...new Set(people.flatMap((person) => person.accounts.map(accountId)))].filter(Boolean);
}

/**
 * The people who are only a card: imported, or written down by hand.
 *
 * Most of an address book is people you are not currently messaging, and until these were read back the
 * list simply did not show them - an import of two hundred contacts stored two hundred cards and put none
 * of them on screen. They arrive as accounts like any other, with the numbers and addresses the card
 * carries as their identity keys, so the merging then does its job: a card with a number a bridge also
 * publishes becomes one person with that chat rather than a second entry beside it.
 */
function contactsFromCards(client: MatrixClient): Account[] {
    const accounts: Account[] = [];
    for (const [key, card] of Object.entries(allCards(client))) {
        // A card stored against a Matrix ID belongs to somebody the list already has.
        if (!key.startsWith("vcard:")) continue;
        const identifiers = [
            ...(card.phones ?? []).map((phone) => `tel:${phone.value}`),
            ...(card.emails ?? []).map((email) => `mailto:${email.value}`),
        ];
        // Named by what it holds, never by its storage key: a card with nothing at all to show is left out.
        const name = cardLabel(card);
        if (!name) continue;
        accounts.push({
            network: "Contacts",
            remoteId: key,
            name,
            keys: identityKeys(identifiers),
            details: identityDetails(identifiers),
            identifiers,
            // They are in the address book; that is the whole of what these are.
            saved: true,
        });
    }
    return accounts;
}

/**
 * Everybody you know, merged, with the links you made applied.
 *
 * `ask` is what the list costs. Asking means a request per person for the identifiers that merge two
 * accounts into one row, and a request per bridge for its own address book; not asking means only what the
 * client already holds, which is every chat the reader has. A reader opening the list wants to see it now,
 * so it is built both ways - from the rooms at once, and again when the answers arrive - and only the
 * second build can merge accounts or know who is saved. Answers are cached, so the wait happens once.
 */
export async function allPeople(
    client: MatrixClient,
    { ask = true, fresh = false, also = [] }: { ask?: boolean; fresh?: boolean; also?: string[] } = {},
): Promise<Person[]> {
    const [fromBridges, fromChats] = await Promise.all([
        ask ? bridgeContacts(client, fresh) : [],
        contactsFromChats(client, ask),
    ]);
    // People asked for by name who are in neither: a group's member the reader has no chat with.
    const known = new Set([...fromBridges, ...fromChats].map((account) => account.mxid));
    const others = await Promise.all(
        also
            .filter((userId) => !known.has(userId) && userId !== client.getSafeUserId())
            .map((userId) => accountOfUser(client, userId)),
    );
    /*
     * Not the reader themselves. Their own account on each network is a ghost like any other - it turns up
     * in the network's address book and in a chat with themselves - and it listed the reader among their
     * own contacts. A bridge login's id is the network's id for the account it is logged in as.
     */
    const own = new Set(bridgeLogins(client).map((login) => login.loginId));
    const notMine = (account: Account): boolean => !own.has(account.remoteId);
    return withReaderNames(
        client,
        groupAccounts(
            [...fromBridges, ...fromChats, ...others, ...contactsFromCards(client)].filter(notMine),
            manualLinks(client),
            keptApart(client),
        ),
    );
}

/**
 * The names the reader wrote themselves go first of all: a nickname they gave, then the name on the card
 * they keep for the person.
 */
export function withReaderNames(client: MatrixClient, people: Person[]): Person[] {
    return people
        .map((person) => {
            const card = cardFor(client, person);
            const name = chosenName(client, person) || (card && (fullName(card) || card.nickname?.trim()));
            return name ? { ...person, name } : person;
        })
        .sort((a, b) => a.name.localeCompare(b.name));
}
