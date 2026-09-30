/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it, vi } from "vitest";
import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";

import { bridgeInfoForNetwork } from "./NetworkLogo";

vi.mock("../../../utils/bridge/bridgeInfo", () => ({
    getBridgeInfo: (room: { network?: string }) =>
        room.network
            ? {
                  protocolId: room.network.toLowerCase(),
                  networkName: room.network,
                  avatarUrl: `mxc://e/${room.network}`,
              }
            : undefined,
}));

const clientWith = (rooms: { network?: string }[]): MatrixClient =>
    ({
        getRooms: () => rooms.map((one) => ({ ...one, currentState: {} }) as unknown as Room),
    }) as unknown as MatrixClient;

describe("a network's badge without a chat", () => {
    // Somebody from a network's contact list has no chat yet; any chat of the same bridge names the network.
    it("finds the network through any room its bridge carries", () => {
        const client = clientWith([{}, { network: "Telegram" }, { network: "Instagram" }]);
        expect(bridgeInfoForNetwork(client, "Instagram")?.avatarUrl).toBe("mxc://e/Instagram");
        expect(bridgeInfoForNetwork(client, "instagram")?.networkName).toBe("Instagram");
    });

    it("has nothing for a network no room is bridged to", () => {
        expect(bridgeInfoForNetwork(clientWith([{ network: "Telegram" }]), "Signal")).toBeUndefined();
    });
});
