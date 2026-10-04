/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it, vi } from "vitest";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { savedOnNetworks } from "./people";
import { askBridge, type BridgeLogin, bridgeLogins } from "../bridge/provisioning";

vi.mock("../bridge/provisioning", async () => ({
    // @ts-ignore
    ...(await vi.importActual("../bridge/provisioning")),
    bridgeLogins: vi.fn(),
    askBridge: vi.fn(),
}));

describe("savedOnNetworks", () => {
    it("says whose ghosts each network's own address book holds", async () => {
        const login = {
            network: "Telegram",
            loginId: "1",
            provisioningUrl: "https://bridge.example",
            can: { searchUsers: true, listContacts: true, createDm: true },
        } as unknown as BridgeLogin;
        vi.mocked(bridgeLogins).mockReturnValue([login]);
        vi.mocked(askBridge).mockResolvedValue({
            contacts: [
                { id: "1", name: "Ada", mxid: "@telegram_1:e" },
                { id: "2", name: "Nobody bridged yet" },
            ],
        });
        const client = { getSafeUserId: () => "@me:e" } as unknown as MatrixClient;

        expect(await savedOnNetworks(client)).toEqual(new Map([["@telegram_1:e", "Telegram"]]));
        expect(askBridge).toHaveBeenCalledWith(client, login, "v3/contacts", undefined, expect.anything());
    });
});
