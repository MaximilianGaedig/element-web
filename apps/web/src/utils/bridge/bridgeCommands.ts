/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";

import { getBridgeBots, getBridgeInfo } from "./bridgeInfo";
import { knownBridges } from "./knownBridges";
import { type BridgeLogin, bridgeLoginsIn } from "../bridgeLogins";

/*
 * Commands to a bridge bot (mautrix bridgev2), and who a composer message actually goes to.
 *
 * In a bridged chat ("portal") a message that starts with the bridge's command prefix (`!tg`, `!wa`, ...) is
 * a command for the bridge and is NOT relayed to the person on the other network; anything else is. In the
 * bridge's own management room (your chat with the bot) every message is a command. The bridge decides this
 * with a bare `HasPrefix` on the body (mautrix-go bridgev2/queue.go), so this does too.
 *
 * Bridges do not publish their commands (MSC4391 `command_description` state is defined by mautrix-go's
 * cmdschema package, but bridgev2 never sends it), so the commands are listed here: bridgev2's own, plus
 * the extra ones of each network's connector.
 */

export interface BridgeCommandSpec {
    name: string;
    aliases?: string[];
    /** `<required> [optional]`, as the bridge's help shows it. */
    args?: string;
    description: string;
    /** Where it makes sense: in a bridged chat, or in the management room. Both when left out. */
    scope?: "portal" | "management";
}

/** What every bridgev2 bridge answers to (mautrix-go bridgev2/commands). */
const CORE_COMMANDS: BridgeCommandSpec[] = [
    { name: "help", description: "Show the commands of this bridge" },
    { name: "login", args: "[flow ID]", description: "Log in to the network", scope: "management" },
    { name: "relogin", args: "<login ID> [flow ID]", description: "Log in again", scope: "management" },
    { name: "logout", args: "<login ID>", description: "Log out of the network", scope: "management" },
    { name: "list-logins", description: "List your logins", scope: "management" },
    { name: "cancel", description: "Cancel the action in progress" },
    { name: "search", args: "<query>", description: "Search for people on the network", scope: "management" },
    {
        name: "resolve-identifier",
        args: "[login ID] <identifier>",
        description: "Check whether someone is on the network",
        scope: "management",
    },
    {
        name: "start-chat",
        aliases: ["pm"],
        args: "[login ID] <identifier>",
        description: "Start a direct chat with someone",
        scope: "management",
    },
    {
        name: "create-portal",
        args: "[login ID] <chat ID>",
        description: "Make a room for a chat on the network",
        scope: "management",
    },
    {
        name: "sync-chats",
        description: "Go over your chat list again and make rooms for new chats",
        scope: "management",
    },
    { name: "import-image-pack", args: "<url>", description: "Import a sticker or emoji pack" },
    { name: "id", description: "Show this chat's ID on the network", scope: "portal" },
    { name: "sync-portal", description: "Update this room from the network", scope: "portal" },
    {
        name: "bridge",
        args: "[login ID] <chat ID>",
        description: "Bridge a chat on the network to this room",
        scope: "portal",
    },
    { name: "unbridge", description: "Stop bridging this room", scope: "portal" },
    {
        name: "mute",
        aliases: ["unmute"],
        args: "[duration]",
        description: "Mute or unmute the chat on the network",
        scope: "portal",
    },
    {
        name: "delete-chat",
        args: "[--for-everyone]",
        description: "Delete this chat on the network",
        scope: "portal",
    },
    {
        name: "create-group",
        aliases: ["create"],
        args: "[group type]",
        description: "Make a group on the network from this room",
        scope: "portal",
    },
    {
        name: "set-relay",
        args: "[login ID]",
        description: "Send other people's messages through your account",
        scope: "portal",
    },
    { name: "unset-relay", description: "Stop relaying other people's messages", scope: "portal" },
    {
        name: "set-preferred-login",
        aliases: ["prefer"],
        args: "<login ID>",
        description: "Choose which account sends in this chat",
        scope: "portal",
    },
    {
        name: "backfill",
        args: "[status|skip]",
        description: "Import this chat's history, or show how much is imported",
        scope: "portal",
    },
    { name: "backfill-all", description: "Import the history of every chat", scope: "management" },
    { name: "recreate-portal", description: "Replace this room with a new one for the same chat", scope: "portal" },
    { name: "delete-portal", description: "Delete this room", scope: "portal" },
];

/** What a network's connector adds, by {@link networkKeyOf}. */
const NETWORK_COMMANDS: Record<string, BridgeCommandSpec[]> = {
    telegram: [
        { name: "sync-chats", args: "[login ID]", description: "Synchronize your chats", scope: "management" },
        { name: "join", args: "[login ID] <invite link>", description: "Join a group with an invite link" },
        { name: "upgrade", description: "Upgrade a minigroup to a supergroup", scope: "portal" },
        {
            name: "emoji-pack",
            aliases: ["pack", "sticker-pack", "emojipack", "stickerpack"],
            args: "<upload/download/list/help> [args...]",
            description: "Bridge emoji packs between Matrix and Telegram",
        },
    ],
    whatsapp: [
        { name: "accept", description: "Accept a group invite (reply to the invite)", scope: "portal" },
        { name: "sync", args: "<group/groups/contacts>", description: "Sync data from WhatsApp", scope: "management" },
        {
            name: "invite-link",
            args: "[--reset]",
            description: "Get this group's invite link, or replace it",
            scope: "portal",
        },
        { name: "resolve-link", args: "<link>", description: "Resolve a group invite or business message link" },
        { name: "join", args: "<invite link>", description: "Join a group with an invite link" },
        { name: "decline-call", description: "Decline the call ringing in this chat", scope: "portal" },
    ],
    signal: [
        {
            name: "discard-sender-key",
            args: "[login ID]",
            description: "Discard the Signal-side sender key of this group",
            scope: "portal",
        },
    ],
    facebook: [
        { name: "toggle-encryption", description: "Turn Messenger-side encryption on or off here", scope: "portal" },
    ],
    instagram: [
        { name: "toggle-encryption", description: "Turn Messenger-side encryption on or off here", scope: "portal" },
    ],
    olx: [
        {
            name: "message-ad",
            args: "<ad ID or address> <message>",
            description: "Write to the seller of an ad",
            scope: "management",
        },
    ],
};

/** Each connector's `DefaultCommandPrefix`, for when the bridge has not said which prefix it runs with. */
const DEFAULT_PREFIXES: Record<string, string> = {
    telegram: "!tg",
    whatsapp: "!wa",
    signal: "!signal",
    facebook: "!fb",
    instagram: "!ig",
    discord: "!discord",
    olx: "!olx",
};

/** "Telegram" or "telegram" -> "telegram"; "Facebook Messenger" -> "facebook". Undefined for networks we do not know. */
export function networkKeyOf(name: string | undefined): string | undefined {
    const lower = name?.toLowerCase() ?? "";
    for (const key of Object.keys(DEFAULT_PREFIXES)) {
        if (lower.includes(key)) return key;
    }
    return /messenger|meta/.test(lower) ? "facebook" : undefined;
}

/** The commands of a bridge, for a bridged chat or for the management room. */
export function bridgeCommandsFor(networkKey: string | undefined, kind: "portal" | "management"): BridgeCommandSpec[] {
    const byName = new Map<string, BridgeCommandSpec>();
    for (const spec of [...CORE_COMMANDS, ...(networkKey ? (NETWORK_COMMANDS[networkKey] ?? []) : [])]) {
        if (spec.scope && spec.scope !== kind) continue;
        byName.set(spec.name, spec); // the connector's own entry replaces bridgev2's
    }
    return [...byName.values()];
}

/** The bridge a room is talking to. */
export interface BridgeCommandContext {
    /** A chat on the network (commands only with the prefix), or the bridge's management room (all commands). */
    kind: "portal" | "management";
    /** "Telegram", as a person names it. */
    network: string;
    /** `telegram`, `whatsapp`, ... or undefined for a bridge we have no command list for. */
    networkKey?: string;
    /** `!tg`: what makes a message a command in a chat. */
    prefix: string;
    botId?: string;
}

/** Every command prefix of the bridges we know, by network, for spotting a command meant for another bridge. */
export interface KnownPrefix {
    prefix: string;
    network: string;
}

interface Resolved {
    context: BridgeCommandContext | undefined;
    prefixes: KnownPrefix[];
}

interface Logins {
    userId: string | null;
    at: number;
    logins: BridgeLogin[];
    prefixes: KnownPrefix[];
}

// Reading the logins walks every room we are in, and the composer asks on every keystroke.
const CACHE_MS = 15_000;
let loginCache: Logins | undefined;

/** @knipignore Tests start from a clean slate with it. */
export function resetBridgeCommandCache(): void {
    loginCache = undefined;
}

function prefixOf(prefix: string | undefined, networkKey: string | undefined): string {
    return prefix || (networkKey ? DEFAULT_PREFIXES[networkKey] : "") || "";
}

function loginsOf(client: MatrixClient): Logins {
    if (loginCache && loginCache.userId === client.getUserId() && Date.now() - loginCache.at < CACHE_MS) {
        return loginCache;
    }
    const logins = bridgeLoginsIn(client);
    const prefixes = new Map<string, string>();
    for (const login of logins) {
        const prefix = prefixOf(login.commandPrefix, networkKeyOf(login.network));
        if (prefix) prefixes.set(prefix, login.network);
    }
    for (const [networkKey, prefix] of Object.entries(DEFAULT_PREFIXES)) {
        if (!prefixes.has(prefix)) prefixes.set(prefix, networkKey[0].toUpperCase() + networkKey.slice(1));
    }
    loginCache = {
        userId: client.getUserId(),
        at: Date.now(),
        logins,
        prefixes: [...prefixes].map(([prefix, network]) => ({ prefix, network })),
    };
    return loginCache;
}

function resolve(client: MatrixClient, room: Room): Resolved {
    const { logins, prefixes } = loginsOf(client);

    let context: BridgeCommandContext | undefined;
    const info = getBridgeInfo(room);
    if (info) {
        const bots = getBridgeBots(room);
        const login = logins.find((l) => l.botId && bots.has(l.botId));
        const networkKey = networkKeyOf(info.protocolId) ?? networkKeyOf(info.networkName);
        const prefix = prefixOf(login?.commandPrefix, networkKey);
        if (prefix) {
            context = {
                kind: "portal",
                network: info.networkName,
                networkKey,
                prefix,
                botId: login?.botId ?? [...bots][0],
            };
        }
    } else {
        const login = logins.find((l) => l.room.roomId === room.roomId);
        let bot = login?.botId;
        let network = login?.network;
        if (!login && room.getInvitedAndJoinedMemberCount() === 2) {
            // The bot's chat before the first login has no login state; the server names its bridges.
            const known = knownBridges(client).find((b) => room.getMember(b.bot)?.membership === "join");
            bot = known?.bot;
            network = known?.network;
        }
        if (bot && network) {
            const networkKey = networkKeyOf(network);
            context = {
                kind: "management",
                network,
                networkKey,
                prefix: prefixOf(login?.commandPrefix, networkKey),
                botId: bot,
            };
        }
    }

    return { context, prefixes };
}

/** Which bridge a room's messages go to, or undefined for a room that is neither a bridged chat nor a bridge's management room. */
export function getBridgeCommandContext(client: MatrixClient, room: Room): BridgeCommandContext | undefined {
    return resolve(client, room).context;
}

/** What the composer's text will be to the bridge and to the person on the other side. */
export type ComposerTarget =
    /** A command for the bridge bot: not sent to anyone on the network. */
    | { kind: "command"; bridge: BridgeCommandContext }
    /** Plain text in a bridged chat: sent on to the person (or group) on the network. */
    | { kind: "relay"; bridge: BridgeCommandContext }
    /** Looks like a command for another bridge, so it would go to the person on this network as text. */
    | { kind: "wrong-bridge"; bridge: BridgeCommandContext; intended: KnownPrefix }
    | { kind: "none" };

/** The leading `!word` of a message, when it is one. */
const BANG_WORD_RE = /^(![A-Za-z0-9_-]+)(?=\s|$)/;

export function classifyComposerText(client: MatrixClient, room: Room, text: string): ComposerTarget {
    const { context: bridge, prefixes } = resolve(client, room);
    if (!bridge) return { kind: "none" };
    if (bridge.kind === "management") return { kind: "command", bridge };
    if (text.startsWith(bridge.prefix)) return { kind: "command", bridge };
    const word = BANG_WORD_RE.exec(text)?.[1]?.toLowerCase();
    if (word) {
        const intended = prefixes.find((p) => p.prefix.toLowerCase() === word);
        if (intended) return { kind: "wrong-bridge", bridge, intended };
    }
    return { kind: "relay", bridge };
}

/**
 * Whether a message is the bridge bot's own answer (a notice from the bridge's bot, in a bridged chat or in
 * its management room), as opposed to something a person wrote.
 */
export function isBridgeBotNotice(client: MatrixClient, room: Room | null | undefined, ev: MatrixEvent): boolean {
    if (!room || ev.getType() !== "m.room.message" || ev.getContent().msgtype !== "m.notice") return false;
    const sender = ev.getSender();
    if (!sender) return false;
    if (getBridgeBots(room).has(sender)) return true;
    const context = getBridgeCommandContext(client, room);
    return context?.kind === "management" && context.botId === sender;
}
