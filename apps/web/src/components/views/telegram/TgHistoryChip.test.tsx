/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";
import { stubClient } from "test-utils";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import MatrixClientContext from "../../../contexts/MatrixClientContext";
import { HistoryStatusChip, HistoryStatusMini, setHistoryStatusOpen } from "./TgHistoryChip";
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
        setHistoryStatusOpen(false);
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

    /** The two as the app has them: the tick in the list's header, the chip above the list. */
    const both = () =>
        show(
            <>
                <HistoryStatusChip />
                <HistoryStatusMini />
            </>,
        );

    it("opens back into the full chip from the tick, and closes into it again", async () => {
        imports(10, 0);
        const { container } = both();
        const tick = screen.getByRole("button", { name: "All 10 chats imported" });
        expect(container.querySelector(".mx_TgHistoryChip")).toBeNull();
        expect(tick).toHaveAttribute("aria-expanded", "false");

        await userEvent.click(tick);
        const chip = container.querySelector(".mx_TgHistoryChip");
        expect(chip).toHaveTextContent("All 10 chats imported");
        // Finished is finished: 99% beside "all imported" would be the cap showing, not a fact.
        expect(chip).not.toHaveTextContent("%");
        expect(tick).toHaveAttribute("aria-expanded", "true");

        await userEvent.click(tick);
        expect(container.querySelector(".mx_TgHistoryChip")).toBeNull();
    });

    it("stays in full, with no tick, while a bridge needs you - even with every chat in", () => {
        // Nothing left to import is not "all is well" when the bridge those chats came through is logged out.
        vi.mocked(bridgeLoginsIn).mockReturnValue([{ network: "telegram", health: "disconnected" }] as never);
        imports(10, 0);
        const { container } = both();
        const chip = container.querySelector(".mx_TgHistoryChip");
        expect(chip).toHaveTextContent("telegram is not connected");
        expect(chip).toHaveTextContent("All 10 chats imported");
        expect(container.querySelector(".mx_TgHistoryChip_mini")).toBeNull();
    });

    it("says the import is paused, on a line of its own, when the bridge it waits for is not connected", () => {
        vi.mocked(bridgeLoginsIn).mockReturnValue([{ network: "telegram", health: "disconnected" }] as never);
        imports(10, 4);
        const { container } = both();
        /*
         * One line each. Run together they are wider than the chat list, and the import was the half
         * that got cut off - so a disconnected bridge showed nothing of its import after all.
         */
        const lines = [...container.querySelectorAll(".mx_TgHistoryChip_line")].map((line) => line.textContent);
        expect(lines).toEqual(["telegram is not connected", "Import paused · 6 of 10 chats"]);
    });

    it("says importing, not paused, while another bridge is still working", () => {
        vi.mocked(bridgeLoginsIn).mockReturnValue([
            { network: "telegram", health: "connected" },
            { network: "whatsapp", health: "disconnected" },
        ] as never);
        imports(10, 4);
        const { container } = both();
        const lines = [...container.querySelectorAll(".mx_TgHistoryChip_line")].map((line) => line.textContent);
        expect(lines).toEqual(["whatsapp is not connected", "Importing history · 6 of 10 chats"]);
    });

    it("minimises again by itself when an import that was opened from the tick starts up and finishes", async () => {
        imports(10, 0);
        const { container, unmount } = both();
        await userEvent.click(screen.getByRole("button", { name: "All 10 chats imported" }));
        expect(container.querySelector(".mx_TgHistoryChip")).not.toBeNull();
        unmount();

        // More history arrives: the chip is there because of the import now, not because it was opened.
        imports(12, 2);
        both().unmount();

        imports(12, 0);
        const after = both();
        expect(after.container.querySelector(".mx_TgHistoryChip")).toBeNull();
        expect(screen.getByRole("button", { name: "All 12 chats imported" })).toBeInTheDocument();
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
