/*
Copyright 2024 New Vector Ltd.
Copyright 2018 Michael Telatynski <7t3chguy@gmail.com>
Copyright 2017 Vector Creations Ltd
Copyright 2017 New Vector Ltd
Copyright 2016 Aviral Dasgupta

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React from "react";
import { type Room } from "matrix-js-sdk/src/matrix";

import { _t } from "../languageHandler";
import AutocompleteProvider from "./AutocompleteProvider";
import QueryMatcher from "./QueryMatcher";
import { TextualCompletion } from "./Components";
import { type ICompletion, type ISelectionRange } from "./Autocompleter";
import { type Command, Commands, CommandMap } from "../slash-commands/SlashCommands";
import { type TimelineRenderingType } from "../contexts/RoomContext";
import { MatrixClientPeg } from "../MatrixClientPeg";
import {
    type BotCommand,
    type RoomBotCommands,
    botCommandCompletion,
    findBotCommand,
    getRoomBotCommands,
} from "../utils/bridge/botCommands";

// `@username` is only used by Telegram bot commands in group chats (`/command@somebot`).
const COMMAND_RE = /(^\/\w*(?:@\w*)?)(?: .*)?/g;

export default class CommandProvider extends AutocompleteProvider {
    public matcher: QueryMatcher<Command>;
    private room: Room;
    public constructor(room: Room, renderingType?: TimelineRenderingType) {
        super({ commandRegex: COMMAND_RE, renderingType });
        this.matcher = new QueryMatcher(Commands, {
            keys: ["command", "args", "description"],
            funcs: [({ aliases }) => aliases.join(" ")], // aliases
            context: renderingType,
        });
        this.room = room;
    }

    public async getCompletions(
        query: string,
        selection: ISelectionRange,
        force?: boolean,
        limit = -1,
    ): Promise<ICompletion[]> {
        const { command, range } = this.getCurrentCommand(query, selection);
        if (!command) return [];

        const cli = MatrixClientPeg.get();

        // Fork: the Telegram bot commands of the room (fi.mau.telegram.bot_commands) come first, and win
        // over Element commands of the same name. Those stay reachable as `//name` (see routeSlashMessage).
        const botCommands = getRoomBotCommands(this.room);
        const botCompletions = botCommands ? this.getBotCompletions(botCommands, command, range!) : [];
        const shadowed = new Set(botCommands?.commands.map((c) => c.command.toLowerCase()));

        let matches: Command[] = [];
        // check if the full match differs from the first word (i.e. returns false if the command has args)
        if (command[0] !== command[1]) {
            // The input looks like a command with arguments, perform exact match
            const name = command[1].slice(1); // strip leading `/`
            if (shadowed.has(name.toLowerCase())) return botCompletions;
            if (CommandMap.has(name) && CommandMap.get(name)!.isEnabled(cli, this.room.roomId)) {
                // some commands, namely `me` don't suit having the usage shown whilst typing their arguments
                if (CommandMap.get(name)!.hideCompletionAfterSpace) return [];
                matches = [CommandMap.get(name)!];
            }
        } else {
            if (query === "/") {
                // If they have just entered `/` show everything
                // We exclude the limit on purpose to have a comprehensive list
                matches = Commands;
            } else {
                // otherwise fuzzy match against all of the fields
                matches = this.matcher.match(command[1], limit);
            }
        }

        const elementCompletions = matches
            .filter((cmd) => {
                const display = !cmd.renderingTypes || cmd.renderingTypes.includes(this.renderingType);
                return cmd.isEnabled(cli, this.room.roomId) && display && !shadowed.has(cmd.command.toLowerCase());
            })
            .map((result): ICompletion => {
                let completion = result.getCommand() + " ";
                const usedAlias = result.aliases.find((alias) => `/${alias}` === command[1]);
                // If the command (or an alias) is the same as the one they entered, we don't want to discard their arguments
                if (usedAlias || result.getCommand() === command[1]) {
                    completion = command[0];
                }

                return {
                    completion,
                    type: "command",
                    component: (
                        <TextualCompletion
                            title={`/${usedAlias || result.command}`}
                            subtitle={result.args}
                            description={_t(result.description)}
                        />
                    ),
                    range: range!,
                };
            });
        return [...botCompletions, ...elementCompletions];
    }

    /**
     * Completions for the room's Telegram bot commands, like Telegram offers them: prefix matches on
     * the command name (and on the bot's username after an `@`), with the bot's description.
     */
    private getBotCompletions(
        { commands, isDm }: RoomBotCommands,
        command: RegExpExecArray | RegExpMatchArray,
        range: ISelectionRange,
    ): ICompletion[] {
        let matches: BotCommand[];
        if (command[0] !== command[1]) {
            // Arguments are being typed: only the exact command, keeping what was typed.
            const exact = findBotCommand(this.room, command[0]);
            matches = exact ? [exact] : [];
        } else {
            const [name, username] = command[1].slice(1).toLowerCase().split("@", 2);
            matches = commands.filter(
                (c) =>
                    c.command.toLowerCase().startsWith(name) &&
                    (username === undefined || !!c.username?.toLowerCase().startsWith(username)),
            );
        }

        return matches.map((cmd) => {
            const text = botCommandCompletion(cmd, isDm);
            const keepTyped = command[0] !== command[1] || text.toLowerCase() === command[1].toLowerCase();
            return {
                completion: keepTyped ? command[0] : text + " ",
                type: "command",
                component: (
                    <TextualCompletion
                        title={text}
                        subtitle={!isDm && cmd.username ? `@${cmd.username}` : undefined}
                        description={cmd.description}
                    />
                ),
                range,
            };
        });
    }

    public getName(): string {
        return "*️⃣ " + _t("composer|autocomplete|command_description");
    }

    public renderCompletions(completions: React.ReactNode[]): React.ReactNode {
        return (
            <div
                className="mx_Autocomplete_Completion_container_pill"
                aria-label={_t("composer|autocomplete|command_a11y")}
            >
                {completions}
            </div>
        );
    }
}
