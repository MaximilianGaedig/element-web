/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Finding somebody on a bridged network who has never been bridged.
 *
 * Search asks the homeserver's user directory, and the homeserver knows a bridged person only once they have
 * a ghost - which happens the first time you talk to them. So the one question search should answer, "who is
 * called X?", answers only for people you have already spoken to: a Messenger contact you have never
 * messaged cannot be found at all, and typing their name reads as "they are not there" rather than "nobody
 * asked Messenger".
 *
 * Each bridge can answer it about its own network: mautrix bridges implement `SearchUsers` per network and
 * expose it as `POST /v3/search_users` on their provisioning API. They also say, in the login state event in
 * their management room with you, where that API is and whether this login supports the endpoint (mautrix-go
 * `bridgev2/bridgelogin.go`), so nothing here needs configuring per deployment - a bridge that is logged in
 * and says it can be searched is searched, and one that says nothing is skipped.
 *
 * Authenticated as yourself: the bridge accepts your own Matrix access token when `allow_matrix_auth` is on,
 * which is the only reason it publishes its address at all. No shared secret ever reaches the client.
 *
 * A search result is a real Matrix user - the bridge makes the ghost while answering - so the rest of the
 * client needs no new idea of a person: starting a chat works the way it does with anybody else, and the
 * bridge creates the portal.
 */

import { type MatrixClient } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import { DirectoryMember } from "../direct-messages";

/** Where a bridge says its provisioning API is, and what this login of it can do. */
const BRIDGE_LOGIN_EVENT_TYPE = "im.mxg.bridge_login";

/** How long a bridge gets to answer before the search goes on without it. */
const GIVE_UP_MS = 8000;

interface Searchable {
    /** The login to search with: one account of one network. */
    loginId: string;
    network: string;
    provisioningUrl: string;
}

/** One person on a network, as the bridge describes them. */
interface Found {
    id: string;
    name?: string;
    avatar_url?: string;
    mxid?: string;
    /** The network's own disambiguating line: mutual friends, a location, a username. */
    context?: string;
}

/**
 * A person found on a network, carrying the line the network uses to tell them apart.
 *
 * Three people called Max Müller are three identical rows, and a ghost's Matrix ID
 * (`@facebook_100000000000001:…`) tells the reader nothing at all - so what Messenger shows under the
 * name, "12 mutual friends" or "Lives in Warsaw", is the only thing that makes the list pickable. A
 * DirectoryMember in every other respect, so everything that takes a member still takes this.
 */
export class NetworkMember extends DirectoryMember {
    public constructor(
        found: { user_id: string; display_name?: string; avatar_url?: string },
        public readonly context?: string,
    ) {
        super(found);
    }
}

/** What to show under a result's name: what the network said, else the Matrix ID. */
export const contextOf = (member: object): string | undefined =>
    member instanceof NetworkMember ? member.context : undefined;

/**
 * The logins that can be searched: logged in, reachable, and saying so themselves.
 *
 * Read from room state rather than kept anywhere, because that is where the bridge writes it and it is
 * already synced; a bridge that is down still has its last word here, and a request to it simply fails.
 */
function searchableLogins(client: MatrixClient): Searchable[] {
    const found: Searchable[] = [];
    for (const room of client.getRooms()) {
        for (const event of room.currentState.getStateEvents(BRIDGE_LOGIN_EVENT_TYPE) ?? []) {
            const content = event.getContent();
            const url = content.provisioning_url;
            if (typeof url !== "string" || !url || !content.can?.search_users) continue;
            if (content.state === "BAD_CREDENTIALS" || content.state === "LOGGED_OUT") continue;
            found.push({
                loginId: event.getStateKey() ?? "",
                network: typeof content.network === "string" ? content.network : "a bridged network",
                provisioningUrl: url,
            });
        }
    }
    return found;
}

/** Asks one login's bridge who on its network matches. */
async function askBridge(
    client: MatrixClient,
    login: Searchable,
    query: string,
    signal: AbortSignal,
): Promise<DirectoryMember[]> {
    const token = client.getAccessToken();
    if (!token) return [];
    const url = new URL(`${login.provisioningUrl}/v3/search_users`);
    url.searchParams.set("login_id", login.loginId);
    url.searchParams.set("user_id", client.getSafeUserId());
    const response = await fetch(url.toString(), {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
        signal,
    });
    if (!response.ok) throw new Error(`${response.status} from the bridge`);
    const body: { results?: Found[] } = await response.json();
    return (
        (body.results ?? [])
            // Without a Matrix ID there is nothing to open a chat with; the bridge makes one for anybody it can.
            .filter((one) => !!one.mxid)
            .map(
                (one) =>
                    new NetworkMember(
                        { user_id: one.mxid!, display_name: one.name, avatar_url: one.avatar_url },
                        one.context,
                    ),
            )
    );
}

/**
 * Everybody the bridged networks say matches, deduplicated.
 *
 * Every bridge is asked at once and one that fails or is slow costs nothing: search is watched while typing,
 * so one network being down must not hold up the networks that are up.
 */
export async function searchNetworkPeople(client: MatrixClient, query: string): Promise<DirectoryMember[]> {
    if (!query.trim()) return [];
    const searchable = searchableLogins(client);
    if (!searchable.length) return [];

    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), GIVE_UP_MS);
    try {
        const answers = await Promise.allSettled(
            searchable.map((login) => askBridge(client, login, query, stop.signal)),
        );
        const byUserId = new Map<string, DirectoryMember>();
        for (const [at, answer] of answers.entries()) {
            if (answer.status === "rejected") {
                logger.warn(`Could not search ${searchable[at].network} for people`, answer.reason);
                continue;
            }
            for (const member of answer.value) {
                if (!byUserId.has(member.userId)) byUserId.set(member.userId, member);
            }
        }
        return [...byUserId.values()];
    } finally {
        clearTimeout(timer);
    }
}
