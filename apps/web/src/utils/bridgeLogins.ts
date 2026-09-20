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

import { getBridgeBots, getBridgeInfo } from "./bridge/bridgeInfo";

export const BRIDGE_LOGIN_EVENT_TYPE = "im.mxg.bridge_login";

export type LoginHealth = "connected" | "connecting" | "problem" | "disconnected" | "unreported";

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

/**
 * The bridges your chats come through that publish no login state (the legacy Discord bridge, or a bridge
 * that is not logged in at all, so has no login to describe): one entry each, with their chat with you so
 * you can open it. Bridges already in `known` are left out.
 */
export function bridgesWithoutLoginState(client: MatrixClient, known: BridgeLogin[]): BridgeLogin[] {
    const reporting = new Set(known.map((login) => login.botId));
    const networks = new Map<string, { network: string; chats: number }>();
    for (const room of client.getRooms()) {
        const info = getBridgeInfo(room);
        if (!info) continue;
        for (const bot of getBridgeBots(room)) {
            if (reporting.has(bot)) continue;
            const entry = networks.get(bot) ?? { network: info.networkName, chats: 0 };
            entry.chats++;
            networks.set(bot, entry);
        }
    }
    const me = client.getSafeUserId();
    const out: BridgeLogin[] = [];
    for (const [bot, { network }] of networks) {
        // Your chat with the bot: a room with just the two of you that is not itself a bridged chat.
        const management = client
            .getRooms()
            .find(
                (room) =>
                    !getBridgeInfo(room) &&
                    room.getInvitedAndJoinedMemberCount() === 2 &&
                    room.getMember(bot)?.membership === "join" &&
                    room.getMember(me)?.membership === "join",
            );
        if (!management) continue;
        out.push({
            room: management,
            accountId: bot,
            botId: bot,
            state: "UNREPORTED",
            health: "unreported",
            network,
            commandPrefix: "",
            updatedTs: 0,
        });
    }
    return out.sort((a, b) => a.network.localeCompare(b.network));
}
