/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { beforeEach, describe, expect, it } from "vitest";
import { type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";

import { BRIDGE_LOGIN_EVENT_TYPE } from "../bridgeLogins";
import {
    bridgeCommandsFor,
    classifyComposerText,
    getBridgeCommandContext,
    isBridgeBotNotice,
    networkKeyOf,
    resetBridgeCommandCache,
} from "./bridgeCommands";

type State = Record<string, { stateKey: string; sender?: string; content: object }[]>;

/** A room holding whatever state events the test needs, which is all these functions read. */
function room(roomId: string, state: State, members: Record<string, string> = {}): Room {
    return {
        roomId,
        getMyMembership: () => "join",
        getInvitedAndJoinedMemberCount: () => Object.keys(members).length,
        getMember: (id: string) => (members[id] ? { membership: members[id] } : null),
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

const portal = (id: string, network = "telegram", bot = "@tgbot:x", type = "dm"): Room =>
    room(id, {
        "m.bridge": [
            {
                stateKey: "",
                content: {
                    "protocol": { id: network, displayname: network[0].toUpperCase() + network.slice(1) },
                    "bridgebot": bot,
                    "com.beeper.room_type.v2": type,
                },
            },
        ],
    });

const management = (id: string, bot: string, network: string, prefix: string): Room =>
    room(id, {
        [BRIDGE_LOGIN_EVENT_TYPE]: [
            { stateKey: "acct", sender: bot, content: { state: "CONNECTED", network, command_prefix: prefix } },
        ],
    });

const clientWith = (rooms: Room[], wellKnown: object = {}): MatrixClient =>
    ({
        getRooms: () => rooms,
        getUserId: () => "@me:x",
        getClientWellKnown: () => wellKnown,
    }) as unknown as MatrixClient;

describe("bridge command contexts", () => {
    beforeEach(() => resetBridgeCommandCache());

    it("uses the prefix the bridge publishes for its chats", () => {
        const chat = portal("!chat:x");
        const client = clientWith([chat, management("!mgmt:x", "@tgbot:x", "Telegram", "!telegram")]);
        expect(getBridgeCommandContext(client, chat)).toMatchObject({ kind: "portal", prefix: "!telegram" });
    });

    it("falls back to the connector's default prefix before there is a login", () => {
        const wa = portal("!wa:x", "whatsapp", "@wabot:x");
        expect(getBridgeCommandContext(clientWith([wa]), wa)).toMatchObject({ kind: "portal", prefix: "!wa" });
        const signal = portal("!sg:x", "signal", "@sgbot:x");
        expect(getBridgeCommandContext(clientWith([signal]), signal)).toMatchObject({ prefix: "!signal" });
    });

    it("recognises the management room by its login state, or by the server's list of bridges", () => {
        const mgmt = management("!mgmt:x", "@tgbot:x", "Telegram", "!tg");
        expect(getBridgeCommandContext(clientWith([mgmt]), mgmt)).toMatchObject({
            kind: "management",
            network: "Telegram",
            prefix: "!tg",
        });

        const fresh = room("!fresh:x", {}, { "@me:x": "join", "@wabot:x": "join" });
        const wellKnown = {
            "im.mxg.bridges": [{ bot: "@wabot:x", network: "WhatsApp", provisioning_url: "https://bridge.example/wa" }],
        };
        expect(getBridgeCommandContext(clientWith([fresh], wellKnown), fresh)).toMatchObject({
            kind: "management",
            network: "WhatsApp",
            prefix: "!wa",
        });
    });

    it("has nothing to say about an ordinary room", () => {
        const plain = room("!plain:x", {}, { "@me:x": "join", "@friend:x": "join" });
        expect(getBridgeCommandContext(clientWith([plain]), plain)).toBeUndefined();
        expect(classifyComposerText(clientWith([plain]), plain, "!tg login")).toEqual({ kind: "none" });
    });
});

describe("classifyComposerText", () => {
    beforeEach(() => resetBridgeCommandCache());
    const chat = portal("!chat:x");
    const client = (): MatrixClient => clientWith([chat, management("!mgmt:x", "@tgbot:x", "Telegram", "!tg")]);

    it("treats a message with the prefix, in a chat, as a command that is not relayed", () => {
        expect(classifyComposerText(client(), chat, "!tg help").kind).toBe("command");
        expect(classifyComposerText(client(), chat, "!tg").kind).toBe("command");
    });

    it("treats other text in a chat as a message to the person on the network", () => {
        expect(classifyComposerText(client(), chat, "hello").kind).toBe("relay");
        expect(classifyComposerText(client(), chat, "see !tg help").kind).toBe("relay");
        expect(classifyComposerText(client(), chat, "/start").kind).toBe("relay");
    });

    it("treats everything in the management room as a command", () => {
        const mgmt = management("!mgmt:x", "@tgbot:x", "Telegram", "!tg");
        const c = clientWith([mgmt]);
        expect(classifyComposerText(c, mgmt, "login").kind).toBe("command");
        expect(classifyComposerText(c, mgmt, "!tg login").kind).toBe("command");
    });

    it("warns about a command for another bridge, which would be sent to the person as text", () => {
        const target = classifyComposerText(client(), chat, "!wa login");
        expect(target).toMatchObject({ kind: "wrong-bridge", intended: { prefix: "!wa" } });
        // Case does not matter for recognising it, and an unknown !word is just text.
        expect(classifyComposerText(client(), chat, "!WA help").kind).toBe("wrong-bridge");
        expect(classifyComposerText(client(), chat, "!important thing").kind).toBe("relay");
    });

    it("also catches the prefix the other bridge really runs with", () => {
        const wa = portal("!wa:x", "whatsapp", "@wabot:x");
        const c = clientWith([wa, chat, management("!m:x", "@tgbot:x", "Telegram", "!tg")]);
        expect(classifyComposerText(c, wa, "!tg help")).toMatchObject({
            kind: "wrong-bridge",
            intended: { network: "Telegram" },
        });
    });
});

describe("bridgeCommandsFor", () => {
    it("lists the commands that make sense where they are typed, plus the network's own", () => {
        const portalNames = bridgeCommandsFor("telegram", "portal").map((c) => c.name);
        expect(portalNames).toEqual(expect.arrayContaining(["help", "mute", "backfill", "upgrade"]));
        expect(portalNames).not.toContain("login");

        const mgmtNames = bridgeCommandsFor("telegram", "management").map((c) => c.name);
        expect(mgmtNames).toEqual(expect.arrayContaining(["help", "login", "sync-chats", "join", "emoji-pack"]));
        expect(mgmtNames).not.toContain("mute");
    });

    it("has each network's own commands", () => {
        expect(bridgeCommandsFor("whatsapp", "portal").map((c) => c.name)).toContain("invite-link");
        expect(bridgeCommandsFor("signal", "portal").map((c) => c.name)).toContain("discard-sender-key");
        expect(bridgeCommandsFor("facebook", "portal").map((c) => c.name)).toContain("toggle-encryption");
        expect(bridgeCommandsFor("olx", "management").map((c) => c.name)).toContain("message-ad");
        // The connector's entry replaces bridgev2's of the same name.
        expect(bridgeCommandsFor("telegram", "management").find((c) => c.name === "sync-chats")?.args).toBe(
            "[login ID]",
        );
    });

    it("names networks the way their bridges do", () => {
        expect(networkKeyOf("Telegram")).toBe("telegram");
        expect(networkKeyOf("Facebook Messenger")).toBe("facebook");
        expect(networkKeyOf("Something else")).toBeUndefined();
    });
});

describe("isBridgeBotNotice", () => {
    beforeEach(() => resetBridgeCommandCache());
    const ev = (sender: string, msgtype: string, type = "m.room.message"): MatrixEvent =>
        ({ getType: () => type, getSender: () => sender, getContent: () => ({ msgtype }) }) as unknown as MatrixEvent;

    it("is the bridge bot's notice in a chat or its management room, and nobody else's", () => {
        const chat = portal("!chat:x");
        const mgmt = management("!mgmt:x", "@tgbot:x", "Telegram", "!tg");
        const client = clientWith([chat, mgmt]);

        expect(isBridgeBotNotice(client, chat, ev("@tgbot:x", "m.notice"))).toBe(true);
        expect(isBridgeBotNotice(client, mgmt, ev("@tgbot:x", "m.notice"))).toBe(true);
        // A person's message, or the bot's own text (not a reply), or someone else's notice.
        expect(isBridgeBotNotice(client, chat, ev("@tgbot:x", "m.text"))).toBe(false);
        expect(isBridgeBotNotice(client, chat, ev("@friend:x", "m.notice"))).toBe(false);
        expect(isBridgeBotNotice(client, chat, ev("@tgbot:x", "m.notice", "m.sticker"))).toBe(false);
    });
});
