/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "test-utils-rtl";
import { stubClient } from "test-utils";
import { type Room } from "matrix-js-sdk/src/matrix";

import BridgesUserSettingsTab from "./BridgesUserSettingsTab";
import MatrixClientContext from "../../../../../contexts/MatrixClientContext";
import Modal from "../../../../../Modal";
import dis from "../../../../../dispatcher/dispatcher";
import BridgeLoginDialog from "../../../dialogs/BridgeLoginDialog";
import * as bridgeLogins from "../../../../../utils/bridgeLogins";
import { type BridgeLogin } from "../../../../../utils/bridgeLogins";

vi.mock("../../../../../utils/importOverview", () => ({
    // Nothing being imported: the cards are what is looked at here
    collectImports: () => ({ chats: 0, networks: [], entries: [] }),
    importHeadline: () => undefined,
}));
vi.mock("../../../../../utils/bridge/declaredSettings", () => ({ declaredSettings: () => [] }));
vi.mock("../../../../../utils/chatHistory", async () => ({
    ...(await vi.importActual<object>("../../../../../utils/chatHistory")),
    onBridgeStatusChange: () => () => {},
}));
vi.mock("./importDetail", () => ({
    Bar: () => null,
    eta: () => "",
    number: (n: number) => String(n),
    NetworkImportDetail: () => null,
}));

const API = "https://bridge.example/_matrix/provision";
const room = { roomId: "!mgmt:example.org", getJoinedMembers: () => [], getMember: () => null } as unknown as Room;
const login = (over: Partial<BridgeLogin>): BridgeLogin => ({
    room,
    accountId: "acct",
    botId: "@telegrambot:example.org",
    state: "CONNECTED",
    health: "connected",
    network: "Telegram",
    commandPrefix: "!tg",
    updatedTs: 0,
    ...over,
});

describe("<BridgesUserSettingsTab />", () => {
    const createDialog = vi.spyOn(Modal, "createDialog").mockReturnValue({} as any);
    const dispatched = vi.spyOn(dis, "dispatch").mockImplementation(() => {});

    beforeEach(() => {
        createDialog.mockClear();
        dispatched.mockClear();
        vi.spyOn(bridgeLogins, "bridgesWithoutLoginState").mockReturnValue([]);
    });

    const open = (...logins: BridgeLogin[]) => {
        vi.spyOn(bridgeLogins, "bridgeLoginsIn").mockReturnValue(logins);
        const client = stubClient();
        vi.spyOn(client, "getProfileInfo").mockResolvedValue({});
        return render(
            <MatrixClientContext.Provider value={client}>
                <BridgesUserSettingsTab />
            </MatrixClientContext.Provider>,
        );
    };

    it("adds an account by asking the bridge, where the bridge can be asked", () => {
        open(login({ provisioningUrl: API }));

        screen.getByRole("button", { name: "Add account" }).click();

        expect(createDialog).toHaveBeenCalledWith(
            BridgeLoginDialog,
            expect.objectContaining({ network: "Telegram", provisioningUrl: API, again: undefined }),
        );
    });

    it("signs a logged-out account back in the same way, as that account, with no typing to the bot", () => {
        open(login({ provisioningUrl: API, state: "LOGGED_OUT", health: "disconnected" }));

        expect(screen.queryByText(/!tg login/)).toBeNull();
        screen.getByRole("button", { name: "Log in again" }).click();

        expect(createDialog).toHaveBeenCalledWith(BridgeLoginDialog, expect.objectContaining({ again: "acct" }));
    });

    it("falls back to the bridge's chat for a bridge that cannot be asked", () => {
        open(login({ state: "LOGGED_OUT", health: "disconnected" }));

        expect(screen.queryByRole("button", { name: "Add account" })).toBeNull();
        expect(screen.getByText(/!tg login/)).toBeInTheDocument();
        screen.getByRole("button", { name: "Log in again" }).click();

        expect(createDialog).not.toHaveBeenCalled();
        expect(dispatched).toHaveBeenCalledWith(expect.objectContaining({ room_id: "!mgmt:example.org" }));
    });

    it("gives the dialog the bridge's chat to send a sign-in it cannot do to", () => {
        open(login({ provisioningUrl: API }));
        screen.getByRole("button", { name: "Add account" }).click();

        const props = createDialog.mock.calls[0][1] as { onOpenChat(): void };
        props.onOpenChat();

        expect(dispatched).toHaveBeenCalledWith(expect.objectContaining({ room_id: "!mgmt:example.org" }));
    });
});
