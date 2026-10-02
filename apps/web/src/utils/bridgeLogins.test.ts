/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";
import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";

import { BRIDGE_LOGIN_EVENT_TYPE, bridgeHealthOf, bridgeLoginsIn, loginHealth } from "./bridgeLogins";

/** A room holding whatever state events the test needs, which is all these functions read. */
function room(
    state: Record<string, { stateKey: string; sender?: string; content: object }[]>,
    membership = "join",
): Room {
    return {
        getMyMembership: () => membership,
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

const bridged = (bot: string, extra: object = {}): Parameters<typeof room>[0] => ({
    "m.bridge": [{ stateKey: "", content: { protocol: { id: "telegram" }, bridgebot: bot } }],
    ...extra,
});

const login = (bot: string, state: string) => ({
    stateKey: "acct",
    sender: bot,
    content: { state, network: "Telegram" },
});

const clientWith = (...rooms: Room[]): MatrixClient => ({ getRooms: () => rooms }) as unknown as MatrixClient;

describe("loginHealth", () => {
    it("tells the states that need a new login from the ones that will pass", () => {
        expect(loginHealth("CONNECTED")).toBe("connected");
        expect(loginHealth("CONNECTING")).toBe("connecting");
        expect(loginHealth("TRANSIENT_DISCONNECT")).toBe("problem");
        expect(loginHealth("LOGGED_OUT")).toBe("disconnected");
        expect(loginHealth("BAD_CREDENTIALS")).toBe("disconnected");
        // Anything a future bridge invents is worth a look rather than silently fine.
        expect(loginHealth("SOMETHING_NEW")).toBe("problem");
    });
});

// The client keeps a room it has left, with the state it last saw there.
describe("a bridge whose chat we have left", () => {
    const left = (): Room => room({ [BRIDGE_LOGIN_EVENT_TYPE]: [login("@oldbot:x", "CONNECTED")] }, "leave");
    const current = (): Room => room({ [BRIDGE_LOGIN_EVENT_TYPE]: [login("@newbot:x", "CONNECTED")] });

    it("is not listed, nor its chat offered to open", () => {
        const logins = bridgeLoginsIn(clientWith(left(), current()));

        expect(logins.map((found) => found.botId)).toEqual(["@newbot:x"]);
    });

    it("no longer speaks for the chats it used to carry", () => {
        const chat = room(bridged("@oldbot:x"));
        const gone = room({ [BRIDGE_LOGIN_EVENT_TYPE]: [login("@oldbot:x", "LOGGED_OUT")] }, "leave");

        expect(bridgeHealthOf(clientWith(chat, gone), chat)).toBeUndefined();
    });
});

describe("bridgeHealthOf", () => {
    it("matches a chat to the bridge it comes through, by the bot that bridges it", () => {
        const chat = room(bridged("@telegrambot:x"));
        const management = room({ [BRIDGE_LOGIN_EVENT_TYPE]: [login("@telegrambot:x", "LOGGED_OUT")] });
        expect(bridgeHealthOf(clientWith(chat, management), chat)).toBe("disconnected");
    });

    it("does not answer for a chat that is not bridged at all", () => {
        const native = room({});
        const management = room({ [BRIDGE_LOGIN_EVENT_TYPE]: [login("@telegrambot:x", "LOGGED_OUT")] });
        // Not "connected" either: the caller must be able to tell "fine" from "nothing to say", or
        // every message in an ordinary Matrix room gets marked by whatever a bridge happens to report.
        expect(bridgeHealthOf(clientWith(native, management), native)).toBeUndefined();
    });

    it("says nothing about a bridge that publishes no login state", () => {
        const chat = room(bridged("@oldbridgebot:x"));
        const management = room({ [BRIDGE_LOGIN_EVENT_TYPE]: [login("@telegrambot:x", "CONNECTED")] });
        expect(bridgeHealthOf(clientWith(chat, management), chat)).toBeUndefined();
    });

    it("does not let one bridge's health stand for another's", () => {
        const telegram = room(bridged("@telegrambot:x"));
        const management = room({
            [BRIDGE_LOGIN_EVENT_TYPE]: [login("@signalbot:x", "LOGGED_OUT"), login("@telegrambot:x", "CONNECTED")],
        });
        expect(bridgeHealthOf(clientWith(telegram, management), telegram)).toBe("connected");
    });
});
