/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * How a bridged account is told apart in a list: by what its network knows it as.
 *
 * The Matrix ID of a ghost (`@telegram_123456789:server`) is the bridge's bookkeeping and says nothing to the
 * reader. What the network itself shows is a username (`@ada` on Telegram, Instagram) or a phone number
 * (WhatsApp, Signal, Telegram), which mautrix publishes on the ghost's profile as identifiers
 * (`telegram:ada`, `tel:+48...`; see utils/contacts/people.ts), so that is what is shown instead.
 */

import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { getBridgeInfo } from "../bridge/bridgeInfo";
import { emailKey, phoneKey } from "./identity";

/** What a ghost's profile publishes about the account it stands for. */
export interface PublishedIdentity {
    /** The network's id (`telegram`, `whatsapp`); absent for a Matrix account of its own. */
    network?: string;
    remoteId?: string;
    identifiers: string[];
}

/**
 * The username or number the network knows the account by, as the network writes it: `@ada`, `+48 ...`.
 * A username first, because that is what a network shows beside a name; then a number, then an address.
 */
export function networkHandle(identifiers: readonly string[]): string | undefined {
    let phone: string | undefined;
    let email: string | undefined;
    for (const raw of identifiers) {
        const one = raw.trim();
        const scheme = one.slice(0, Math.max(0, one.indexOf(":"))).toLowerCase();
        const value = one.slice(scheme.length + 1).trim();
        if (scheme === "tel") phone ??= phoneKey(value)?.slice("tel:".length) ?? (value || undefined);
        else if (scheme === "mailto") email ??= emailKey(value)?.slice("mailto:".length);
        // `telegram:ada`, `instagram:ada`: a username on that network.
        else if (scheme && value && !value.includes(":")) return `@${value.replace(/^@/, "")}`;
    }
    return phone ?? email;
}

const networkNames = new Map<string, string>();

/**
 * What a network is called, from its id: the name its bridge gives it in the rooms it bridges, which is the
 * name every other part of the client shows. Only the id is on a ghost's profile.
 */
function networkName(client: MatrixClient, network: string): string {
    const known = networkNames.get(network);
    if (known) return known;
    for (const room of client.getVisibleRooms()) {
        const info = getBridgeInfo(room);
        if (info?.protocolId === network && info.networkName) {
            networkNames.set(network, info.networkName);
            return info.networkName;
        }
    }
    return network.charAt(0).toUpperCase() + network.slice(1);
}

/**
 * The line under a bridged person's name: what the network knows them as and which network, `@ada ·
 * Telegram`, or the network alone when it published nothing. Undefined for a Matrix account, whose Matrix
 * ID is its handle.
 */
export function bridgedPersonLine(client: MatrixClient, identity: PublishedIdentity): string | undefined {
    if (!identity.network) return undefined;
    const name = networkName(client, identity.network);
    const handle = networkHandle(identity.identifiers);
    return handle ? `${handle} · ${name}` : name;
}
