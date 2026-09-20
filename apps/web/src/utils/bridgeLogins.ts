/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Whether each bridge is connected to its network as your account. Bridges keep this in the state of your
 * management room with them (`im.mxg.bridge_login`, one entry per account), so it can be shown anywhere
 * without reading the bridge's chat.
 */

import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";

export const BRIDGE_LOGIN_EVENT_TYPE = "im.mxg.bridge_login";

export type LoginHealth = "connected" | "connecting" | "problem" | "disconnected";

export interface BridgeLogin {
    room: Room;
    accountId: string;
    /** The bridge's bot, which wrote the entry. */
    botId?: string;
    /** CONNECTED, CONNECTING, TRANSIENT_DISCONNECT, BAD_CREDENTIALS, UNKNOWN_ERROR, … */
    state: string;
    health: LoginHealth;
    error?: string;
    message?: string;
    remoteName?: string;
    network: string;
    commandPrefix: string;
    updatedTs: number;
}

/** What a bridge state means for the user: fine, working on it, needs a look, or needs a new login. */
export function loginHealth(state: string): LoginHealth {
    switch (state) {
        case "CONNECTED":
            return "connected";
        case "STARTING":
        case "CONNECTING":
        case "BACKFILLING":
            return "connecting";
        case "TRANSIENT_DISCONNECT":
        case "UNKNOWN_ERROR":
            return "problem";
        case "BAD_CREDENTIALS":
        case "LOGGED_OUT":
        case "UNCONFIGURED":
            return "disconnected";
        default:
            return "problem";
    }
}

export function bridgeLoginsIn(client: MatrixClient): BridgeLogin[] {
    const logins: BridgeLogin[] = [];
    for (const room of client.getRooms()) {
        const events = room.currentState.getStateEvents(BRIDGE_LOGIN_EVENT_TYPE);
        for (const event of events ?? []) {
            const content = event.getContent();
            if (!content.state) continue;
            logins.push({
                room,
                accountId: event.getStateKey() ?? "",
                botId: event.getSender() ?? undefined,
                state: content.state,
                health: loginHealth(content.state),
                error: content.error,
                message: content.message,
                remoteName: content.remote_name,
                network: content.network ?? "",
                commandPrefix: content.command_prefix ?? "",
                updatedTs: Number(content.updated_ts) || 0,
            });
        }
    }
    return logins.sort((a, b) => a.network.localeCompare(b.network));
}
