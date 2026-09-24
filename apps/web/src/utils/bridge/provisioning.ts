/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Asking the bridges things the homeserver cannot answer.
 *
 * A bridge knows its network: who is on it, what their phone number is, who you have not spoken to yet. The
 * homeserver knows only what has already happened here. So some questions have to go to the bridge, and each
 * bridge says where to ask - `provisioning_url` and a `can` block in the login state event it writes in your
 * management room with it (mautrix-go `bridgev2/bridgelogin.go`).
 *
 * Authenticated as yourself with your own access token, which is the only reason a bridge publishes its
 * address at all (`provisioning.allow_matrix_auth`). No shared secret is ever in the client.
 *
 * One place for this, because two features already need it: searching a network for people
 * (bridge/networkPeople.ts) and listing who is on it (contacts/people.ts).
 */

import { type MatrixClient } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

/** Where a bridge says its provisioning API is, and what this login of it can do. */
const BRIDGE_LOGIN_EVENT_TYPE = "im.mxg.bridge_login";

/** How long a bridge gets to answer before we go on without it. */
const GIVE_UP_MS = 8000;

/** One account on one network, and how to ask it things. */
export interface BridgeLogin {
    loginId: string;
    /** The network's name as the bridge gives it, for saying which network a person is on. */
    network: string;
    provisioningUrl: string;
    /** Which of the optional endpoints this login supports. */
    can: { searchUsers: boolean; listContacts: boolean; createDm: boolean };
}

/** One person on a network, in the shape every provisioning endpoint answers with. */
export interface BridgePerson {
    id: string;
    name?: string;
    avatar_url?: string;
    mxid?: string;
    /** `tel:+48…`, `mailto:…`, a username: what the network knows them by. */
    identifiers?: string[];
    /** The line the network shows to tell people with the same name apart. */
    context?: string;
    dm_room_mxid?: string;
}

/**
 * The logins worth asking: reachable, not logged out, and saying so themselves.
 *
 * Read from room state rather than kept anywhere, because that is where the bridge writes it and it is
 * already synced. A bridge that is down still has its last word here, and the request to it simply fails.
 */
export function bridgeLogins(client: MatrixClient): BridgeLogin[] {
    const logins: BridgeLogin[] = [];
    for (const room of client.getRooms()) {
        for (const event of room.currentState.getStateEvents(BRIDGE_LOGIN_EVENT_TYPE) ?? []) {
            const content = event.getContent();
            const url = content.provisioning_url;
            if (typeof url !== "string" || !url) continue;
            if (content.state === "BAD_CREDENTIALS" || content.state === "LOGGED_OUT") continue;
            logins.push({
                loginId: event.getStateKey() ?? "",
                network: typeof content.network === "string" ? content.network : "a bridged network",
                provisioningUrl: url,
                can: {
                    searchUsers: !!content.can?.search_users,
                    listContacts: !!content.can?.list_contacts,
                    createDm: !!content.can?.create_dm,
                },
            });
        }
    }
    return logins;
}

/**
 * One request to one bridge, as yourself.
 *
 * `path` is relative to the provisioning API (`v3/contacts`), and a body makes it a POST. Throws on anything
 * other than success, so the caller can treat one bridge failing as one bridge contributing nothing.
 */
export async function askBridge<T>(
    client: MatrixClient,
    login: BridgeLogin,
    path: string,
    body?: object,
    signal?: AbortSignal,
): Promise<T> {
    const token = client.getAccessToken();
    if (!token) throw new Error("No access token to ask a bridge with");
    const url = new URL(`${login.provisioningUrl}/${path}`);
    url.searchParams.set("login_id", login.loginId);
    url.searchParams.set("user_id", client.getSafeUserId());
    const response = await fetch(url.toString(), {
        method: body ? "POST" : "GET",
        headers: {
            Authorization: `Bearer ${token}`,
            ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal,
    });
    if (!response.ok) throw new Error(`${response.status} from the bridge`);
    return (await response.json()) as T;
}

/**
 * Asks every login at once and keeps whatever comes back.
 *
 * All at once and bounded, because these are watched while typing or while a list draws: one network being
 * slow or down must cost the networks that are up nothing. A login that fails is logged and left out.
 */
export async function askEveryBridge<T>(
    client: MatrixClient,
    logins: BridgeLogin[],
    ask: (login: BridgeLogin, signal: AbortSignal) => Promise<T>,
): Promise<{ login: BridgeLogin; answer: T }[]> {
    if (!logins.length) return [];
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), GIVE_UP_MS);
    try {
        const answers = await Promise.allSettled(logins.map((login) => ask(login, stop.signal)));
        const kept: { login: BridgeLogin; answer: T }[] = [];
        for (const [at, answer] of answers.entries()) {
            if (answer.status === "rejected") {
                logger.warn(`Could not ask ${logins[at].network}`, answer.reason);
                continue;
            }
            kept.push({ login: logins[at], answer: answer.value });
        }
        return kept;
    } finally {
        clearTimeout(timer);
    }
}
