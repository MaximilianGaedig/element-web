/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from "vitest";
import { MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";
import { stubClient } from "test-utils";

import CommandProvider from "./CommandProvider";
import { BOT_COMMANDS_EVENT_TYPE } from "../utils/bridge/botCommands";

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
                { command: "stats", description: "Statistics" },
            ],
        },
    ],
};

function mkRoom(content?: object): Room {
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

async function complete(room: Room, query: string): Promise<string[]> {
    const provider = new CommandProvider(room);
    const completions = await provider.getCompletions(query, {
        beginning: true,
        start: query.length,
        end: query.length,
    });
    return completions.map((c) => c.completion);
}

describe("CommandProvider with Telegram bot commands", () => {
    beforeEach(() => {
        stubClient();
    });

    it("lists the bot's commands first on `/`, and they shadow Element's of the same name", async () => {
        const completions = await complete(mkRoom(DM_CONTENT), "/");
        expect(completions.slice(0, 2)).toEqual(["/start ", "/help "]);
        expect(completions.filter((c) => c === "/help ")).toHaveLength(1);
        // Element's own commands are still offered.
        expect(completions).toContain("/shrug ");
    });

    it("shows the bot command's description", async () => {
        const provider = new CommandProvider(mkRoom(DM_CONTENT));
        const [first] = await provider.getCompletions("/sta", { beginning: true, start: 4, end: 4 });
        expect(first.completion).toBe("/start ");
        expect(first.component.props).toMatchObject({ title: "/start", description: "Start the bot" });
    });

    it("prefix-matches bot commands and keeps typed arguments", async () => {
        // Bot commands first, then Element's (e.g. /status).
        expect((await complete(mkRoom(DM_CONTENT), "/sta"))[0]).toBe("/start ");
        expect(await complete(mkRoom(DM_CONTENT), "/start now")).toEqual(["/start now"]);
        // Element's /help usage must not show up for the bot's /help.
        expect(await complete(mkRoom(DM_CONTENT), "/help me")).toEqual(["/help me"]);
    });

    it("completes to /command@username in groups and filters by username", async () => {
        const room = mkRoom(GROUP_CONTENT);
        expect(await complete(room, "/st")).toEqual(
            expect.arrayContaining(["/start@AlphaBot ", "/start@betabot ", "/stats@betabot "]),
        );
        expect(await complete(room, "/start@b")).toEqual(["/start@betabot "]);
    });

    it("leaves rooms without bot commands alone", async () => {
        const completions = await complete(mkRoom(), "/");
        expect(completions).toContain("/help ");
        expect(completions).not.toContain("/start ");
    });
});
