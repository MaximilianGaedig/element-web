/*
 * Copyright 2025 New Vector Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

// @vitest-environment happy-dom

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, within } from "test-utils-rtl";
import { clientAndSDKContextRenderOptions, createTestClient, TestSDKContext } from "test-utils";
import userEvent from "@testing-library/user-event";

import { setRoomListPanelView } from "../../../../utils/roomListPanelView";
import { MatrixClientPeg } from "../../../../MatrixClientPeg";

import { RoomListPanel } from "./RoomListPanel";
import { shouldShowComponent } from "../../../../customisations/helpers/UIComponents";
import { LandmarkNavigation } from "../../../../accessibility/LandmarkNavigation";
import { ReleaseAnnouncementStore } from "../../../../stores/ReleaseAnnouncementStore";
import { collectImports } from "../../../../utils/importOverview";
import { HistoryStatusChip, setHistoryStatusOpen } from "../../telegram/TgHistoryChip";
import SettingsStore from "../../../../settings/SettingsStore";
import defaultDispatcher from "../../../../dispatcher/dispatcher";
import { Action } from "../../../../dispatcher/actions";

vi.mock("../../../../customisations/helpers/UIComponents", () => ({
    shouldShowComponent: vi.fn(),
}));

vi.mock("../../../../accessibility/LandmarkNavigation", () => ({
    LandmarkNavigation: {
        findAndFocusNextLandmark: vi.fn(),
    },
    Landmark: {
        ROOM_SEARCH: "something",
    },
}));

// The bridges' imports are whatever a test says they are; left alone, the real count of the client's rooms.
vi.mock("../../../../utils/importOverview", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../../../utils/importOverview")>();
    return { ...actual, collectImports: vi.fn(actual.collectImports) };
});

// mock out release announcements as they interfere with what's focused
// (this can be removed once the new room list announcement is gone)
vi.spyOn(ReleaseAnnouncementStore.instance, "getReleaseAnnouncement").mockReturnValue(null);

describe("<RoomListPanel />", () => {
    const client = createTestClient();
    const sdkContext = new TestSDKContext();
    sdkContext._client = client;

    function renderComponent() {
        return render(<RoomListPanel />, clientAndSDKContextRenderOptions(client, sdkContext));
    }

    afterEach(() => setRoomListPanelView("rooms"));

    beforeEach(() => {
        vi.clearAllMocks();

        // By default, we consider shouldShowComponent(UIComponent.FilterContainer) should return true
        vi.mocked(shouldShowComponent).mockReturnValue(true);
    });

    it("renders the bar that moves between the chats, the people, the calls and the settings", () => {
        renderComponent();
        const pill = screen.getByRole("navigation", { name: "Chats, people, calls and settings" });
        expect(pill).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "People" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Calls" })).toBeInTheDocument();
    });

    it("shows contacts in place of the list once the pill asks for them", async () => {
        // ContactsView reads the peg, as every dialog here does; this test only cares that it replaces.
        vi.spyOn(MatrixClientPeg, "safeGet").mockReturnValue(client);
        renderComponent();
        await userEvent.click(screen.getByRole("button", { name: "People" }));
        // The list's own header goes with the list: one column, one thing in it.
        expect(screen.queryByTestId("room-list-header")).toBeNull();
    });

    it("shows the settings' sections in place of the list while the column is on them", () => {
        setRoomListPanelView("settings");
        renderComponent();
        expect(screen.queryByTestId("room-list-header")).toBeNull();
        expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
        expect(screen.getByRole("option", { name: "Account" })).toBeInTheDocument();
        // The bar stays, to go anywhere else from here.
        expect(screen.getByRole("button", { name: "Messages" })).toBeInTheDocument();
    });

    it("offers search beside the bar when UIComponent.FilterContainer is at true", () => {
        renderComponent();
        expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
    });

    it("does not offer search when UIComponent.FilterContainer is at false", () => {
        vi.mocked(shouldShowComponent).mockReturnValue(false);
        renderComponent();
        expect(screen.queryByRole("button", { name: "Search" })).toBeNull();
    });

    /* There is no search row above the list any more: searching is the button beside the bar. */
    it("has no search row or explore button above the list", () => {
        renderComponent();
        expect(screen.queryByRole("button", { name: "Search Ctrl K" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Explore rooms" })).toBeNull();
    });

    /* The Stream (MEO-44) is a labs feature: its button is there only while the feature is on. */
    describe("the Stream button", () => {
        const spies: Array<{ mockRestore(): void }> = [];
        afterEach(() => spies.splice(0).forEach((spy) => spy.mockRestore()));

        const withStream = (enabled: boolean): void => {
            const getValue = SettingsStore.getValue.bind(SettingsStore);
            spies.push(
                vi
                    .spyOn(SettingsStore, "getValue")
                    .mockImplementation(((name: string, ...rest: unknown[]) =>
                        name === "feature_stream"
                            ? enabled
                            : (getValue as (...a: unknown[]) => unknown)(
                                  name,
                                  ...rest,
                              )) as typeof SettingsStore.getValue),
            );
        };

        it("opens the Stream", async () => {
            withStream(true);
            const dispatch = vi.spyOn(defaultDispatcher, "dispatch");
            spies.push(dispatch);
            renderComponent();

            await userEvent.click(screen.getByRole("button", { name: "Stream: every chat in one list" }));

            expect(dispatch).toHaveBeenCalledWith({ action: Action.ViewStream });
        });

        it("is not there while the feature is off", () => {
            withStream(false);
            renderComponent();
            expect(screen.queryByRole("button", { name: "Stream: every chat in one list" })).toBeNull();
        });
    });

    describe("the bridges' status, once every import is done", () => {
        /** One network, every one of its chats in, and nobody's login reported as down. */
        const allImported = (): void => {
            vi.mocked(collectImports).mockReturnValue({
                chats: 10,
                networks: [{ network: "telegram", chats: 10, byPhase: { importing: 0, queued: 0, paused: 0 } }],
                countedImported: 10,
                countedTotal: 10,
            } as unknown as ReturnType<typeof collectImports>);
        };

        /** The chip above the column and the panel under it, as the logged-in view has them. */
        const renderWithChip = () =>
            render(
                <>
                    <HistoryStatusChip />
                    <RoomListPanel />
                </>,
                clientAndSDKContextRenderOptions(client, sdkContext),
            );

        beforeEach(() => setHistoryStatusOpen(false));
        afterEach(() => vi.mocked(collectImports).mockReset());

        it("is a tick among the header's buttons, with the chip above the list gone", () => {
            allImported();
            const { container } = renderWithChip();
            const header = screen.getByTestId("room-list-header");
            expect(within(header).getByRole("button", { name: "All 10 chats imported" })).toBeInTheDocument();
            // Beside the button that looks through the chats, which is where the search row's Explore was.
            expect(within(header).getByRole("button", { name: "What's in my chats" })).toBeInTheDocument();
            expect(container.querySelector(".mx_TgHistoryChip")).toBeNull();
        });

        it("opens the chip from the tick", async () => {
            allImported();
            const { container } = renderWithChip();
            await userEvent.click(screen.getByRole("button", { name: "All 10 chats imported" }));
            expect(container.querySelector(".mx_TgHistoryChip")).toHaveTextContent("All 10 chats imported");
        });

        it("has no tick where nothing is bridged", () => {
            renderWithChip();
            expect(
                within(screen.getByTestId("room-list-header")).queryByRole("button", { name: /imported/ }),
            ).toBeNull();
        });
    });

    it("should move to the next landmark when the shortcut key is pressed", async () => {
        renderComponent();

        const userEv = userEvent.setup();

        // Pick something arbitrary and focusable in the room list component and focus it
        const people = screen.getByRole("button", { name: "People" });
        people.focus();
        expect(people).toHaveFocus();

        screen.getByRole("navigation", { name: "Room list" }).focus();
        await userEv.keyboard("{Control>}{F6}{/Control}");

        expect(LandmarkNavigation.findAndFocusNextLandmark).toHaveBeenCalled();
    });

    it("should not move to the next landmark if room list loses focus", async () => {
        renderComponent();

        const userEv = userEvent.setup();

        // Pick something arbitrary and focusable in the room list component and focus it
        const people = screen.getByRole("button", { name: "People" });
        people.focus();
        expect(people).toHaveFocus();

        people.blur();
        expect(people).not.toHaveFocus();

        await userEv.keyboard("{Control>}{F6}{/Control}");

        expect(LandmarkNavigation.findAndFocusNextLandmark).not.toHaveBeenCalled();
    });
});
