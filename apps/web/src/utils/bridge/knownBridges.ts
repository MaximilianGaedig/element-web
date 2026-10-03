/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The bridges a homeserver offers, from its client well-known (`im.mxg.bridges`).
 *
 * A bridge says where its login API is in the login state it writes into your management room - so only
 * once you have logged in to it. A network you have never used has no such room, and nothing in the
 * client knew the bridge was there to be connected. The server knows which bridges it runs, and says so
 * where every client already looks when it signs in.
 */

import type { MatrixClient } from "matrix-js-sdk/src/matrix";

import type { BridgeLogin } from "../bridgeLogins";

export const KNOWN_BRIDGES_KEY = "im.mxg.bridges";

export interface KnownBridge {
    /** The bridge's bot. */
    bot: string;
    /** The network, as a person would name it. */
    network: string;
    /** The bridge's provisioning API, which takes the user's own Matrix access token. */
    provisioningUrl: string;
}

function isHttpsUrl(value: unknown): value is string {
    if (typeof value !== "string") return false;
    try {
        return new URL(value).protocol === "https:";
    } catch {
        return false;
    }
}

/** What the server says it runs. Entries that are not whole, or whose API is not on https, are left out. */
export function knownBridges(client: MatrixClient): KnownBridge[] {
    const listed = client.getClientWellKnown()?.[KNOWN_BRIDGES_KEY];
    if (!Array.isArray(listed)) return [];
    const bridges: KnownBridge[] = [];
    for (const entry of listed) {
        if (!entry || typeof entry !== "object") continue;
        const { bot, network, provisioning_url: provisioningUrl } = entry as Record<string, unknown>;
        if (typeof bot !== "string" || !bot.startsWith("@")) continue;
        if (typeof network !== "string" || !network) continue;
        if (!isHttpsUrl(provisioningUrl)) continue;
        bridges.push({ bot, network, provisioningUrl });
    }
    return bridges;
}

/** The ones with no account of yours yet: by their bot, or by their API where a login does not say whose it is. */
export function bridgesToConnect(known: KnownBridge[], logins: BridgeLogin[]): KnownBridge[] {
    return known.filter(
        (bridge) =>
            !logins.some((login) => login.botId === bridge.bot || login.provisioningUrl === bridge.provisioningUrl),
    );
}
