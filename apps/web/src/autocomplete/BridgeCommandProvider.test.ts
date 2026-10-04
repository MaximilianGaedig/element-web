/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import { type Room } from "matrix-js-sdk/src/matrix";
import { stubClient } from "test-utils";

import BridgeCommandProvider from "./BridgeCommandProvider";
import { BRIDGE_LOGIN_EVENT_TYPE } from "../utils/bridgeLogins";
import { resetBridgeCommandCache } from "../utils/bridge/bridgeCommands";
import { MatrixClientPeg } from "../MatrixClientPeg";

type State = Record<string, { stateKey: string; sender?: string; content: object }[]>;

function mkRoom(roomId: string, state: State): Room {
    return {
        roomId,
        getMyMembership: () => "join",
        getInvitedAndJoinedMemberCount: () => 2,
        getMember: () => null,
        currentState: {
            getStateEvents: (type: string) =>
                (state[type] ?? []).map((ev) => ({
                    getStateKey: () => ev.stateKey,
                    getSender: () => ev.sender,
                    getContent: () => ev.content,
                    getTs: () => 1,
                })),
        },
    } as unknown as Room;
}

const portalOf = (network: string, bot: string): Room =>
    mkRoom("!chat:x", {
        "m.bridge": [
            {
                stateKey: "",
                content: { protocol: { id: network, displayname: network }, bridgebot: bot },
            },
        ],
    });

const managementOf = (network: string, bot: string, prefix: string): Room =>
    mkRoom("!mgmt:x", {
        [BRIDGE_LOGIN_EVENT_TYPE]: [
            { stateKey: "a", sender: bot, content: { state: "CONNECTED", network, command_prefix: prefix } },
        ],
    });

async function complete(room: Room, query: string): Promise<string[]> {
    const provider = new BridgeCommandProvider(room);
    const completions = await provider.getCompletions(query, {
        beginning: true,
        start: query.length,
        end: query.length,
    });
    return completions.map((c) => c.completion);
}

describe("BridgeCommandProvider", () => {
    beforeEach(() => {
        const client = stubClient();
        resetBridgeCommandCache();
        // The rooms are looked up through the client, like the composer does.
        client.getRooms = () => [];
        client.getUserId = () => "@me:x";
        MatrixClientPeg.get = () => client;
    });

    const withRooms = (...rooms: Room[]): void => {
        MatrixClientPeg.get()!.getRooms = () => rooms;
    };

    it("offers the bridge's prefix when `!` is typed in its chat", async () => {
        const chat = portalOf("Telegram", "@tgbot:x");
        withRooms(chat);
        expect(await complete(chat, "!")).toEqual(["!tg "]);
        expect(await complete(chat, "!t")).toEqual(["!tg "]);
        expect(await complete(chat, "!w")).toEqual([]);
    });

    it("offers each bridge its own prefix", async () => {
        for (const [network, bot, prefix] of [
            ["WhatsApp", "@wa:x", "!wa"],
            ["Signal", "@sg:x", "!signal"],
            ["Facebook Messenger", "@fb:x", "!fb"],
            ["Discord", "@dc:x", "!discord"],
        ]) {
            const chat = portalOf(network, bot);
            withRooms(chat);
            expect(await complete(chat, "!")).toEqual([`${prefix} `]);
        }
    });

    it("completes the bridge's commands after the prefix, with usage, only those that fit a chat", async () => {
        const chat = portalOf("Telegram", "@tgbot:x");
        withRooms(chat);
        const provider = new BridgeCommandProvider(chat);
        const found = await provider.getCompletions("!tg mu", { beginning: true, start: 6, end: 6 });
        expect(found.map((c) => c.completion)).toEqual(["!tg mute "]);
        expect(found[0].component.props).toMatchObject({ title: "!tg mute", subtitle: "[duration]" });

        const all = await complete(chat, "!tg ");
        expect(all).toEqual(expect.arrayContaining(["!tg help ", "!tg backfill ", "!tg upgrade "]));
        expect(all).not.toContain("!tg login ");
    });

    it("keeps what was typed once the command is complete, and shows its usage", async () => {
        const chat = portalOf("Telegram", "@tgbot:x");
        withRooms(chat);
        expect(await complete(chat, "!tg mute 1h")).toEqual(["!tg mute 1h"]);
        expect(await complete(chat, "!tg nosuchcommand x")).toEqual([]);
    });

    it("leaves plain text in a chat alone", async () => {
        const chat = portalOf("Telegram", "@tgbot:x");
        withRooms(chat);
        expect(await complete(chat, "hello")).toEqual([]);
        expect(await complete(chat, "login")).toEqual([]);
    });

    it("offers commands in the management room, with or without the prefix", async () => {
        const mgmt = managementOf("Telegram", "@tgbot:x", "!tg");
        withRooms(mgmt);
        expect(await complete(mgmt, "lo")).toEqual(expect.arrayContaining(["login ", "logout "]));
        expect(await complete(mgmt, "!tg lo")).toEqual(expect.arrayContaining(["!tg login ", "!tg logout "]));
        expect(await complete(mgmt, "login qr")).toEqual(["login qr"]);
        expect((await complete(mgmt, "lo")).every((c) => !c.startsWith("mute"))).toBe(true);
    });

    it("matches aliases", async () => {
        const mgmt = managementOf("Telegram", "@tgbot:x", "!tg");
        withRooms(mgmt);
        expect(await complete(mgmt, "pm")).toEqual(["start-chat "]);
    });

    it("does nothing in a room that is not a bridge's", async () => {
        const plain = mkRoom("!plain:x", {});
        (plain as unknown as { getInvitedAndJoinedMemberCount: () => number }).getInvitedAndJoinedMemberCount = () => 5;
        withRooms(plain);
        expect(await complete(plain, "!tg ")).toEqual([]);
    });
});
