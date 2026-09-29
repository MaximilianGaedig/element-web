/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "test-utils-rtl";
import { stubClient } from "test-utils";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import MatrixClientContext from "../../../contexts/MatrixClientContext";
import { HistoryStatusChip, HistoryStatusMini } from "./TgHistoryChip";
import { collectImports } from "../../../utils/importOverview";
import { bridgeLoginsIn, bridgesWithoutLoginState } from "../../../utils/bridgeLogins";

vi.mock("../../../utils/importOverview", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../utils/importOverview")>()),
    collectImports: vi.fn(),
}));
vi.mock("../../../utils/bridgeLogins", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../utils/bridgeLogins")>()),
    bridgeLoginsIn: vi.fn(),
    bridgesWithoutLoginState: vi.fn(),
}));
vi.mock("../../../utils/chatHistory", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../utils/chatHistory")>()),
    onBridgeStatusChange: () => () => {},
}));

let client!: MatrixClient;

/** One network, `chats` chats, of which `left` are still to come. */
function imports(chats: number, left: number): void {
    vi.mocked(collectImports).mockReturnValue({
        chats,
        networks: [
            {
                network: "telegram",
                chats,
                byPhase: { importing: left, queued: 0, paused: 0, done: chats - left },
                countedImported: chats - left,
                countedTotal: chats,
            },
        ],
        countedImported: chats - left,
        countedTotal: chats,
    } as unknown as ReturnType<typeof collectImports>);
}

describe("the bridge status chips", () => {
    beforeEach(() => {
        client = stubClient();
        vi.mocked(bridgeLoginsIn).mockReturnValue([{ network: "telegram", health: "connected" } as never]);
        vi.mocked(bridgesWithoutLoginState).mockReturnValue([]);
    });

    const show = (ui: React.JSX.Element) =>
        render(<MatrixClientContext.Provider value={client}>{ui}</MatrixClientContext.Provider>);

    it("shows progress while chats are still coming in, and nothing minimised yet", () => {
        imports(10, 4);
        show(<HistoryStatusChip />);
        expect(screen.getByText("Importing history · 6 of 10 chats")).toBeInTheDocument();
        show(<HistoryStatusMini />);
        expect(screen.queryByRole("button", { name: /imported/ })).not.toBeInTheDocument();
    });

    it("minimises to a tick once every chat is in, instead of disappearing", () => {
        imports(10, 0);
        show(<HistoryStatusChip />);
        expect(screen.queryByText(/Importing history/)).not.toBeInTheDocument();
        show(<HistoryStatusMini />);
        expect(screen.getByRole("button", { name: "All 10 chats imported" })).toBeInTheDocument();
    });

    it("still says how far the import got when a bridge is not connected", () => {
        // The whole point of the chip: the network logging out used to hide how far it had got, so
        // the only sign of progress vanished at exactly the moment something had gone wrong.
        vi.mocked(bridgeLoginsIn).mockReturnValue([{ network: "telegram", health: "disconnected" }] as never);
        imports(10, 4);
        show(<HistoryStatusChip />);
        const chip = screen.getByRole("button");
        expect(chip).toHaveTextContent("not connected");
        expect(chip).toHaveTextContent("6 of 10 chats");
        // And the percentage, which is the shortest form of the same answer, is just as true here.
        expect(chip).toHaveTextContent("%");
    });

    it("stays out of the way when there is nothing bridged at all", () => {
        imports(0, 0);
        show(<HistoryStatusMini />);
        expect(screen.queryByRole("button", { name: /imported/ })).not.toBeInTheDocument();
    });
});
