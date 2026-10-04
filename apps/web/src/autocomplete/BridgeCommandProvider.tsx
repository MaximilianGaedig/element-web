/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React from "react";
import { type Room } from "matrix-js-sdk/src/matrix";

import { _t } from "../languageHandler";
import AutocompleteProvider from "./AutocompleteProvider";
import { TextualCompletion } from "./Components";
import { type ICompletion, type ISelectionRange } from "./Autocompleter";
import { type TimelineRenderingType } from "../contexts/RoomContext";
import { MatrixClientPeg } from "../MatrixClientPeg";
import { type BridgeCommandSpec, bridgeCommandsFor, getBridgeCommandContext } from "../utils/bridge/bridgeCommands";

// The first line, since that is where a command is. Whatever follows the cursor is kept by the editor.
const LINE_RE = /^[^\n]*/g;

/** `[login ID] <chat ID>`, as the bridge's help writes it, with the markdown emphasis it uses taken off. */
function argsHint(spec: BridgeCommandSpec): string | undefined {
    return spec.args?.replace(/_/g, "");
}

/**
 * Completes the commands of the bridge a room talks to: after the bridge's prefix (`!tg lo` -> `!tg login`)
 * in a bridged chat, with or without it in the bridge's management room, where every message is a command.
 *
 * Bridges do not publish their commands, so these come from a table (utils/bridge/bridgeCommands). Plain
 * text in a bridged chat is never touched: only a message starting with `!` is a candidate.
 */
export default class BridgeCommandProvider extends AutocompleteProvider {
    private room: Room;

    public constructor(room: Room, renderingType?: TimelineRenderingType) {
        super({ commandRegex: LINE_RE, renderingType });
        this.room = room;
    }

    public async getCompletions(query: string, selection: ISelectionRange): Promise<ICompletion[]> {
        const { command, range } = this.getCurrentCommand(query, selection);
        if (!command || !range) return [];
        const line = command[0];
        if (!line) return [];

        const client = MatrixClientPeg.get();
        const bridge = client && getBridgeCommandContext(client, this.room);
        if (!bridge) return [];
        if (bridge.kind === "portal" && !line.startsWith("!")) return [];

        // `[prefix] [command] [arguments]`, the prefix being optional in the management room.
        const match = /^(\S*)(\s+)?(\S*)(\s+)?/.exec(line)!;
        const [, first, firstGap, second, secondGap] = match;
        const hasPrefix = !!bridge.prefix && first === bridge.prefix && !!firstGap;
        const specs = bridgeCommandsFor(bridge.networkKey, bridge.kind);
        const complete = (spec: BridgeCommandSpec, withPrefix: boolean, typed: boolean): ICompletion => {
            const text = withPrefix ? `${bridge.prefix} ${spec.name}` : spec.name;
            return {
                // A finished command keeps what was typed after it; a half-typed one is completed.
                completion: typed ? line : `${text} `,
                type: "command",
                component: <TextualCompletion title={text} subtitle={argsHint(spec)} description={spec.description} />,
                range,
            };
        };
        const matching = (word: string): BridgeCommandSpec[] =>
            specs.filter((s) =>
                [s.name, ...(s.aliases ?? [])].some((name) => name.toLowerCase().startsWith(word.toLowerCase())),
            );
        const exact = (word: string): BridgeCommandSpec | undefined =>
            specs.find((s) => [s.name, ...(s.aliases ?? [])].some((name) => name.toLowerCase() === word.toLowerCase()));

        // Typing the prefix itself.
        if (!firstGap && first.startsWith("!")) {
            const out: ICompletion[] = [];
            if (bridge.prefix && bridge.prefix.toLowerCase().startsWith(first.toLowerCase())) {
                out.push({
                    completion: first === bridge.prefix ? line : `${bridge.prefix} `,
                    type: "command",
                    component: (
                        <TextualCompletion
                            title={bridge.prefix}
                            description={_t("composer|autocomplete|bridge_prefix_description", {
                                network: bridge.network,
                            })}
                        />
                    ),
                    range,
                });
            }
            return out;
        }

        if (hasPrefix) {
            if (!secondGap) return matching(second).map((s) => complete(s, true, second === s.name));
            const spec = exact(second);
            return spec ? [complete(spec, true, true)] : [];
        }

        if (bridge.kind === "management" && !first.startsWith("!")) {
            if (!firstGap) return matching(first).map((s) => complete(s, false, first === s.name));
            const spec = exact(first);
            return spec ? [complete(spec, false, true)] : [];
        }
        return [];
    }

    public getName(): string {
        return "🌉 " + _t("composer|autocomplete|bridge_command_description");
    }

    public renderCompletions(completions: React.ReactNode[]): React.ReactNode {
        return (
            <div
                className="mx_Autocomplete_Completion_container_pill"
                aria-label={_t("composer|autocomplete|bridge_command_list_a11y")}
            >
                {completions}
            </div>
        );
    }
}
