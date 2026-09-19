/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, it, expect } from "vitest";
import { MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";

import {
    BOT_COMMANDS_EVENT_TYPE,
    botCommandCompletion,
    findBotCommand,
    getRoomBotCommands,
    parseBotCommands,
    routeSlashMessage,
} from "./botCommands";

const DM_CONTENT = {
    bot: "@telegram_123:server",
    commands: [
        { command: "start", description: "Start the bot" },
        { command: "help", description: "Show help" },
    ],
    bots: [
        {
            bot: "@telegram_123:server",
            username: "examplebot",
            commands: [
                { command: "start", description: "Start the bot" },
                { command: "help", description: "Show help" },
            ],
        },
    ],
};

const GROUP_CONTENT = {
    bots: [
        { bot: "@telegram_1:server", username: "AlphaBot", commands: [{ command: "start", description: "Alpha" }] },
        {
            bot: "@telegram_2:server",
            username: "betabot",
            commands: [
                { command: "start", description: "Beta" },
                { command: "stats", description: "" },
            ],
        },
    ],
};

function mkBotRoom(content: object | undefined): Room {
    const ev =
        content &&
        new MatrixEvent({
            type: BOT_COMMANDS_EVENT_TYPE,
            state_key: "",
            content,
            room_id: "!r:server",
            sender: "@b:s",
        });
    return {
        roomId: "!r:server",
        currentState: {
            getStateEvents: (type: string, key: string) => (type === BOT_COMMANDS_EVENT_TYPE && key === "" ? ev : null),
        },
    } as unknown as Room;
}

describe("bot commands", () => {
    it("reads bots from `bots`, keeping usernames, and knows DMs by the top-level bot", () => {
        const dm = parseBotCommands(DM_CONTENT)!;
        expect(dm.isDm).toBe(true);
        expect(dm.commands).toEqual([
            { command: "start", description: "Start the bot", bot: "@telegram_123:server", username: "examplebot" },
            { command: "help", description: "Show help", bot: "@telegram_123:server", username: "examplebot" },
        ]);
        const group = parseBotCommands(GROUP_CONTENT)!;
        expect(group.isDm).toBe(false);
        expect(group.commands.map((c) => `${c.command}@${c.username}`)).toEqual([
            "start@AlphaBot",
            "start@betabot",
            "stats@betabot",
        ]);
    });

    it("falls back to the first version's top-level fields", () => {
        const { bots: _bots, ...v1 } = DM_CONTENT;
        expect(parseBotCommands(v1)).toEqual({
            isDm: true,
            commands: [
                { command: "start", description: "Start the bot", bot: "@telegram_123:server", username: undefined },
                { command: "help", description: "Show help", bot: "@telegram_123:server", username: undefined },
            ],
        });
    });

    it("ignores malformed and empty content", () => {
        expect(parseBotCommands(undefined)).toBeNull();
        expect(parseBotCommands({})).toBeNull();
        expect(parseBotCommands({ bots: [] })).toBeNull();
        expect(
            parseBotCommands({
                bots: [{ bot: "@b:s", commands: [{ command: "has space" }, { command: "/slash" }, { nope: 1 }, "x"] }],
            }),
        ).toBeNull();
        expect(getRoomBotCommands(mkBotRoom(undefined))).toBeNull();
        expect(getRoomBotCommands({ roomId: "!x" } as Room)).toBeNull();
    });

    it("completes /command in DMs and /command@username in groups", () => {
        const dm = parseBotCommands(DM_CONTENT)!;
        expect(botCommandCompletion(dm.commands[0], dm.isDm)).toBe("/start");
        const group = parseBotCommands(GROUP_CONTENT)!;
        expect(botCommandCompletion(group.commands[1], group.isDm)).toBe("/start@betabot");
    });

    it("finds the invoked command, with arguments and @username, case-insensitively", () => {
        const dm = mkBotRoom(DM_CONTENT);
        expect(findBotCommand(dm, "/start")?.command).toBe("start");
        expect(findBotCommand(dm, "/START some args")?.command).toBe("start");
        expect(findBotCommand(dm, "/start@examplebot")?.command).toBe("start");
        expect(findBotCommand(dm, "/start@otherbot")).toBeUndefined();
        expect(findBotCommand(dm, "/starts")).toBeUndefined();
        expect(findBotCommand(dm, "start")).toBeUndefined();
        const group = mkBotRoom(GROUP_CONTENT);
        expect(findBotCommand(group, "/start@BetaBot x")?.bot).toBe("@telegram_2:server");
        expect(findBotCommand(mkBotRoom(undefined), "/start")).toBeUndefined();
    });

    it("routes bot commands as plain messages and //name to a shadowed Element command", () => {
        const dm = mkBotRoom(DM_CONTENT);
        expect(routeSlashMessage(dm, "/start")).toEqual({ kind: "bot" });
        expect(routeSlashMessage(dm, "/help me")).toEqual({ kind: "bot" });
        expect(routeSlashMessage(dm, "//help")).toEqual({ kind: "element", text: "/help" });
        expect(routeSlashMessage(dm, "//shrug hi")).toEqual({ kind: "default" });
        expect(routeSlashMessage(dm, "/shrug hi")).toEqual({ kind: "default" });
        expect(routeSlashMessage(mkBotRoom(undefined), "/help")).toEqual({ kind: "default" });
        expect(routeSlashMessage(mkBotRoom(undefined), "//help")).toEqual({ kind: "default" });
    });
});
