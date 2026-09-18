/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type Room } from "matrix-js-sdk/src/matrix";

/**
 * Room state (state key `""`) in which mautrix-telegram mirrors the `/commands` of the Telegram bots
 * in a chat. Spec: mautrix-telegram `docs/bot-commands.md`.
 *
 * - `bots`: one entry per bot, `{bot, username?, commands: [{command, description}]}`. Present in
 *   every room with the current bridge.
 * - DM portals additionally keep the original top-level `bot` + `commands` fields, which is all that
 *   the first version of the event had.
 */
export const BOT_COMMANDS_EVENT_TYPE = "fi.mau.telegram.bot_commands";

/** A command of a Telegram bot, as offered in the composer. */
export interface BotCommand {
    /** Without the leading `/`. */
    command: string;
    description: string;
    /** Matrix ID of the bot's ghost. */
    bot: string;
    /** The bot's Telegram username (without `@`), if it has one. */
    username?: string;
}

export interface RoomBotCommands {
    /** Whether this is a DM with a bot (the event carries the top-level `bot` field). */
    isDm: boolean;
    commands: BotCommand[];
}

// Telegram: 1-32 characters, latin letters, digits and underscores.
const COMMAND_NAME_RE = /^[A-Za-z0-9_]{1,32}$/;
const USERNAME_RE = /^[A-Za-z0-9_]{1,64}$/;

function parseCommands(raw: unknown, bot: string, username: string | undefined): BotCommand[] {
    if (!Array.isArray(raw)) return [];
    const out: BotCommand[] = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== "object") continue;
        const { command, description } = entry as Record<string, unknown>;
        if (typeof command !== "string" || !COMMAND_NAME_RE.test(command)) continue;
        out.push({
            command,
            description: typeof description === "string" ? description : "",
            bot,
            username,
        });
    }
    return out;
}

/** Parses the content of a {@link BOT_COMMANDS_EVENT_TYPE} state event. Never throws. */
export function parseBotCommands(content: unknown): RoomBotCommands | null {
    if (!content || typeof content !== "object") return null;
    const obj = content as Record<string, unknown>;
    const isDm = typeof obj["bot"] === "string";
    let commands: BotCommand[] = [];

    if (Array.isArray(obj["bots"])) {
        for (const botRaw of obj["bots"]) {
            if (!botRaw || typeof botRaw !== "object") continue;
            const { bot, username, commands: cmds } = botRaw as Record<string, unknown>;
            if (typeof bot !== "string") continue;
            const name = typeof username === "string" && USERNAME_RE.test(username) ? username : undefined;
            commands.push(...parseCommands(cmds, bot, name));
        }
    } else if (isDm) {
        // First version of the event: DMs only, no username.
        commands = parseCommands(obj["commands"], obj["bot"] as string, undefined);
    }

    return commands.length > 0 ? { isDm, commands } : null;
}

/** The Telegram bot commands of a room, or null if it has none. */
export function getRoomBotCommands(room: Room | null | undefined): RoomBotCommands | null {
    try {
        const ev = room?.currentState?.getStateEvents(BOT_COMMANDS_EVENT_TYPE, "");
        return parseBotCommands(ev?.getContent());
    } catch {
        return null;
    }
}

/**
 * The text to insert when completing a bot command: `/command`, or `/command@username` in group
 * chats (where Telegram needs the username to tell several bots apart).
 */
export function botCommandCompletion(cmd: BotCommand, isDm: boolean): string {
    return !isDm && cmd.username ? `/${cmd.command}@${cmd.username}` : `/${cmd.command}`;
}

const SLASH_RE = /^\/([A-Za-z0-9_]+)(?:@([A-Za-z0-9_]+))?(?=\s|$)/;

/**
 * The bot command a message invokes, if any: `/command` or `/command@username`, optionally followed by
 * whitespace and arguments. Names are matched case-insensitively, like Telegram does.
 */
export function findBotCommand(room: Room | null | undefined, text: string): BotCommand | undefined {
    const match = SLASH_RE.exec(text);
    if (!match) return undefined;
    const commands = getRoomBotCommands(room)?.commands;
    if (!commands) return undefined;
    const name = match[1].toLowerCase();
    const username = match[2]?.toLowerCase();
    return commands.find(
        (c) => c.command.toLowerCase() === name && (!username || c.username?.toLowerCase() === username),
    );
}

/** Whether `name` (without `/`) is a command of one of the room's bots. */
export function isBotCommandName(room: Room | null | undefined, name: string): boolean {
    const lower = name.toLowerCase();
    return !!getRoomBotCommands(room)?.commands.some((c) => c.command.toLowerCase() === lower);
}

/**
 * How a composer message starting with `/` is handled in a room with bot commands:
 *
 * - `"bot"`: it invokes a bot command, so it is sent as a plain `m.text` message (no Element slash
 *   command, no "Unknown command" dialog). Bot commands win over Element commands of the same name.
 * - `"element"`: `//name ...` where `name` is both a bot and an Element command. This is how Element's
 *   shadowed command stays reachable; `text` is the message with one `/` removed, to run as the
 *   Element command. (Outside that case `//` keeps its usual meaning: send the text with one `/` removed.)
 * - `"default"`: Element's usual handling.
 */
export type SlashRouting = { kind: "bot" } | { kind: "element"; text: string } | { kind: "default" };

export function routeSlashMessage(room: Room | null | undefined, text: string): SlashRouting {
    if (text.startsWith("//")) {
        const unescaped = text.slice(1);
        const match = SLASH_RE.exec(unescaped);
        if (match && !match[2] && isBotCommandName(room, match[1])) return { kind: "element", text: unescaped };
        return { kind: "default" };
    }
    if (text.startsWith("/") && findBotCommand(room, text)) return { kind: "bot" };
    return { kind: "default" };
}
