/*
 * Copyright 2025 New Vector Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

// @vitest-environment happy-dom

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen } from "test-utils-rtl";
import { clientAndSDKContextRenderOptions, createTestClient, TestSDKContext } from "test-utils";
import userEvent from "@testing-library/user-event";

import { setRoomListPanelView } from "../../../../utils/roomListPanelView";
import { MatrixClientPeg } from "../../../../MatrixClientPeg";

import { RoomListPanel } from "./RoomListPanel";
import { shouldShowComponent } from "../../../../customisations/helpers/UIComponents";
import { LandmarkNavigation } from "../../../../accessibility/LandmarkNavigation";
import { ReleaseAnnouncementStore } from "../../../../stores/ReleaseAnnouncementStore";

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

    it("renders the bar that moves between the chats, the people and the calls", () => {
        renderComponent();
        const pill = screen.getByRole("navigation", { name: "Chats, people and calls" });
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
