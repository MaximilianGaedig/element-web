/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, it, expect } from "vitest";
import type { MatrixClient } from "matrix-js-sdk/src/matrix";

import { bridgesToConnect, knownBridges } from "./knownBridges";
import type { BridgeLogin } from "../bridgeLogins";

const WHATSAPP = {
    bot: "@whatsappbot:example.org",
    network: "WhatsApp",
    provisioning_url: "https://example.org/matrix/mautrix-whatsapp/_matrix/provision",
};
const SIGNAL = {
    bot: "@signalbot:example.org",
    network: "Signal",
    provisioning_url: "https://example.org/matrix/mautrix-signal/_matrix/provision",
};

const clientWith = (wellKnown: unknown): MatrixClient =>
    ({ getClientWellKnown: () => wellKnown }) as unknown as MatrixClient;

describe("knownBridges", () => {
    it("reads the bridges the server lists", () => {
        expect(knownBridges(clientWith({ "im.mxg.bridges": [WHATSAPP, SIGNAL] }))).toEqual([
            { bot: WHATSAPP.bot, network: "WhatsApp", provisioningUrl: WHATSAPP.provisioning_url },
            { bot: SIGNAL.bot, network: "Signal", provisioningUrl: SIGNAL.provisioning_url },
        ]);
    });

    it("has none when the server lists none, or says nothing", () => {
        expect(knownBridges(clientWith(undefined))).toEqual([]);
        expect(knownBridges(clientWith({}))).toEqual([]);
        expect(knownBridges(clientWith({ "im.mxg.bridges": "WhatsApp" }))).toEqual([]);
    });

    // The access token is sent to that address: never to one that is not https, or not an address at all.
    it("leaves out entries that are not whole, or whose API is not on https", () => {
        expect(
            knownBridges(
                clientWith({
                    "im.mxg.bridges": [
                        null,
                        "WhatsApp",
                        { ...WHATSAPP, bot: "whatsappbot" },
                        { ...WHATSAPP, network: "" },
                        { ...WHATSAPP, provisioning_url: "http://example.org/provision" },
                        { ...WHATSAPP, provisioning_url: "javascript:alert(1)" },
                        { ...WHATSAPP, provisioning_url: "not a url" },
                        SIGNAL,
                    ],
                }),
            ).map((bridge) => bridge.network),
        ).toEqual(["Signal"]);
    });
});

describe("bridgesToConnect", () => {
    const known = knownBridges(clientWith({ "im.mxg.bridges": [WHATSAPP, SIGNAL] }));
    const login = (fields: Partial<BridgeLogin>): BridgeLogin => fields as BridgeLogin;

    it("offers every bridge when there are no accounts", () => {
        expect(bridgesToConnect(known, []).map((b) => b.network)).toEqual(["WhatsApp", "Signal"]);
    });

    it("leaves out a bridge with an account, known by its bot", () => {
        expect(bridgesToConnect(known, [login({ botId: WHATSAPP.bot })]).map((b) => b.network)).toEqual(["Signal"]);
    });

    it("leaves out a bridge with an account, known by its API", () => {
        expect(
            bridgesToConnect(known, [login({ provisioningUrl: SIGNAL.provisioning_url })]).map((b) => b.network),
        ).toEqual(["WhatsApp"]);
    });
});
