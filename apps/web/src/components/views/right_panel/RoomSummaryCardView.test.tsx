/*
Copyright 2024 New Vector Ltd.
Copyright 2023 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi, type MockedObject } from "vitest";
import { render, fireEvent, screen } from "test-utils-rtl";
import { Room, type MatrixClient, JoinRule, MatrixEvent, HistoryVisibility } from "matrix-js-sdk/src/matrix";
import userEvent from "@testing-library/user-event";
import { LinkedTextContext } from "@element-hq/web-shared-components";
import { flushPromises, stubClient } from "test-utils";

import RoomSummaryCardView from "./RoomSummaryCardView";
import MatrixClientContext from "../../../contexts/MatrixClientContext";
import { RoomPermalinkCreator } from "../../../utils/permalinks/Permalinks";
import { _t } from "../../../languageHandler";
import {
    type RoomSummaryCardState,
    useRoomSummaryCardViewModel,
} from "../../viewmodels/right_panel/RoomSummaryCardViewModel";
import DMRoomMap from "../../../utils/DMRoomMap";
import { SDKContext } from "../../../contexts/SDKContext";
import { SDKContextClass } from "../../../contexts/SDKContextClass";
import SettingsStore from "../../../settings/SettingsStore";

// Mock the viewmodel hooks
vi.mock("../../viewmodels/right_panel/RoomSummaryCardViewModel", () => ({
    useRoomSummaryCardViewModel: vi.fn(),
}));

describe("<RoomSummaryCard />", () => {
    const userId = "@alice:domain.org";

    const roomId = "!room:domain.org";
    let mockClient!: MockedObject<MatrixClient>;
    let room!: Room;
    let telegram = false;

    const getComponent = (props = {}) => {
        const defaultProps = {
            room,
            onClose: vi.fn(),
            permalinkCreator: new RoomPermalinkCreator(room),
        };

        return render(<RoomSummaryCardView {...defaultProps} {...props} />, {
            wrapper: ({ children }) => (
                <SDKContext.Provider value={SDKContextClass.instance}>
                    <MatrixClientContext.Provider value={mockClient}>
                        <LinkedTextContext.Provider value={{}}>{children}</LinkedTextContext.Provider>
                    </MatrixClientContext.Provider>
                </SDKContext.Provider>
            ),
        });
    };

    // Setup mock view models
    const vmDefaultValues: RoomSummaryCardState = {
        isDirectMessage: false,
        userStatus: undefined,
        isRoomEncrypted: false,
        e2eStatus: undefined,
        isVideoRoom: false,
        roomJoinRule: JoinRule.Public,
        historyVisibility: HistoryVisibility.Shared,
        alias: "",
        isFavorite: false,
        canInviteToState: true,
        pinCount: 0,
        searchInputRef: { current: null },
        onUpdateSearchInput: vi.fn(),
        onRoomMembersClick: vi.fn(),
        onRoomThreadsClick: vi.fn(),
        onRoomFilesClick: vi.fn(),
        onRoomExtensionsClick: vi.fn(),
        onRoomPinsClick: vi.fn(),
        onRoomSettingsClick: vi.fn(),
        onLeaveRoomClick: vi.fn(),
        onShareRoomClick: vi.fn(),
        onRoomExportClick: vi.fn(),
        onRoomPollHistoryClick: vi.fn(),
        onReportRoomClick: vi.fn(),
        onFavoriteToggleClick: vi.fn(),
        onInviteToRoomClick: vi.fn(),
    };

    beforeEach(() => {
        mockClient = vi.mocked(stubClient());
        room = new Room(roomId, mockClient, userId);
        vi.mocked(useRoomSummaryCardViewModel).mockReturnValue(vmDefaultValues);
        // Element's layout unless a test opts into the fork's Telegram-style one (on by default).
        telegram = false;
        const getValue = SettingsStore.getValue.bind(SettingsStore);
        vi.spyOn(SettingsStore, "getValue").mockImplementation(((name: string, ...rest: any[]) =>
            name === "telegramStyleLayout" ? telegram : (getValue as any)(name, ...rest)) as any);
        DMRoomMap.makeShared(mockClient);

        mockClient.getRoom.mockReturnValue(room);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("renders the room summary", () => {
        const { container } = getComponent();
        expect(container).toMatchSnapshot();
    });

    it("renders the room topic in the summary", () => {
        room.currentState.setStateEvents([
            new MatrixEvent({
                type: "m.room.topic",
                room_id: roomId,
                sender: userId,
                content: {
                    topic: "This is the room's topic.",
                },
                state_key: "",
            }),
        ]);
        const { container } = getComponent();
        expect(container).toMatchSnapshot();
    });

    it("has button to edit topic", () => {
        room.currentState.setStateEvents([
            new MatrixEvent({
                type: "m.room.topic",
                room_id: roomId,
                sender: userId,
                content: {
                    topic: "This is the room's topic.",
                },
                state_key: "",
            }),
        ]);
        const { container, getByText } = getComponent();
        expect(getByText("Edit")).toBeInTheDocument();
        expect(container).toMatchSnapshot();
    });

    describe("search", () => {
        it("has the search field", async () => {
            const onSearchChange = vi.fn();
            const { getByPlaceholderText } = getComponent({
                onSearchChange,
            });
            expect(getByPlaceholderText("Search messages…")).toBeVisible();
        });

        it("should focus the search field if focusRoomSearch=true", () => {
            const onSearchChange = vi.fn();
            const { getByPlaceholderText } = getComponent({
                onSearchChange,
                focusRoomSearch: true,
            });
            expect(getByPlaceholderText("Search messages…")).toHaveFocus();
        });

        it("should cancel search on escape", () => {
            const onSearchChange = vi.fn();
            const onSearchCancel = vi.fn();

            const { getByPlaceholderText } = getComponent({
                onSearchChange,
                onSearchCancel,
                focusRoomSearch: true,
            });
            expect(getByPlaceholderText("Search messages…")).toHaveFocus();
            fireEvent.keyDown(getByPlaceholderText("Search messages…"), { key: "Escape" });
            expect(vmDefaultValues.onUpdateSearchInput).toHaveBeenCalled();
        });

        it("should update the search field value correctly", async () => {
            const user = userEvent.setup();

            const onSearchChange = vi.fn();
            const { getByPlaceholderText } = getComponent({
                onSearchChange,
            });

            const searchInput = getByPlaceholderText("Search messages…");
            await user.type(searchInput, "test query");

            expect(onSearchChange).toHaveBeenCalledWith("test query");
            expect(searchInput).toHaveValue("test query");
        });
    });

    it("opens room file panel on button click", () => {
        const { getByText } = getComponent();

        fireEvent.click(getByText("Shared media"));

        expect(vmDefaultValues.onRoomFilesClick).toHaveBeenCalled();
    });

    it("opens room export dialog on button click", () => {
        const { getByText } = getComponent();

        fireEvent.click(getByText(_t("export_chat|title")));

        expect(vmDefaultValues.onRoomExportClick).toHaveBeenCalled();
    });

    it("opens share room dialog on button click", () => {
        const { getByText } = getComponent();

        fireEvent.click(getByText(_t("action|copy_link")));

        expect(vmDefaultValues.onShareRoomClick).toHaveBeenCalled();
    });

    it("opens invite dialog on button click", () => {
        const { getByText } = getComponent();

        fireEvent.click(getByText(_t("action|invite")));

        expect(vmDefaultValues.onInviteToRoomClick).toHaveBeenCalled();
    });

    it("fires favourite dispatch on button click", () => {
        const { getByText } = getComponent();

        fireEvent.click(getByText(_t("room|context_menu|favourite")));

        expect(vmDefaultValues.onFavoriteToggleClick).toHaveBeenCalled();
    });

    it("opens room settings on button click", () => {
        const { getByText } = getComponent();

        fireEvent.click(getByText(_t("common|settings")));

        expect(vmDefaultValues.onRoomSettingsClick).toHaveBeenCalled();
    });

    it("opens room member list on button click", () => {
        const { getByText } = getComponent();

        fireEvent.click(getByText("People"));

        expect(vmDefaultValues.onRoomMembersClick).toHaveBeenCalled();
    });

    it("opens room threads list on button click", () => {
        const { getByText } = getComponent();

        fireEvent.click(getByText("Threads"));

        expect(vmDefaultValues.onRoomThreadsClick).toHaveBeenCalled();
    });

    it("opens room pinned messages on button click", () => {
        const { getByText } = getComponent();

        fireEvent.click(getByText("Pinned messages"));

        expect(vmDefaultValues.onRoomPinsClick).toHaveBeenCalled();
    });

    it("does not render irrelevant options if video room", () => {
        vi.mocked(useRoomSummaryCardViewModel).mockReturnValue({
            ...vmDefaultValues,
            isVideoRoom: true,
        });
        const { queryByText } = getComponent();

        // options not rendered
        expect(queryByText("Shared media")).not.toBeInTheDocument();
        expect(queryByText("Pinned")).not.toBeInTheDocument();
        expect(queryByText("Export chat")).not.toBeInTheDocument();
    });

    describe("pinning", () => {
        it("renders pins options", () => {
            const { getByText } = getComponent();

            expect(getByText("Pinned messages")).toBeInTheDocument();
        });
    });

    describe("poll history", () => {
        it("renders poll history option", () => {
            const { getByText } = getComponent();

            expect(getByText("Polls")).toBeInTheDocument();
        });

        it("opens poll history dialog on button click", () => {
            const permalinkCreator = new RoomPermalinkCreator(room);
            const { getByText } = getComponent({ permalinkCreator });

            fireEvent.click(getByText("Polls"));

            expect(vmDefaultValues.onRoomPollHistoryClick).toHaveBeenCalled();
        });
    });

    describe("public room label", () => {
        it("does not show public room label for a DM", async () => {
            vi.mocked(useRoomSummaryCardViewModel).mockReturnValue({
                ...vmDefaultValues,
                isDirectMessage: true,
            });

            getComponent();

            await flushPromises();

            expect(screen.queryByText("Public room")).not.toBeInTheDocument();
        });

        it("does not show public room label for non public room", async () => {
            vi.mocked(useRoomSummaryCardViewModel).mockReturnValue({
                ...vmDefaultValues,
                isDirectMessage: false,
                roomJoinRule: JoinRule.Invite,
            });
            getComponent();

            await flushPromises();

            expect(screen.queryByText("Public room")).not.toBeInTheDocument();
        });

        it("shows a public room label for a public room", async () => {
            getComponent();

            await flushPromises();

            expect(screen.queryByText("Public room")).toBeInTheDocument();
        });
    });

    describe("user status", () => {
        it("shows the other user's status when set", () => {
            vi.mocked(useRoomSummaryCardViewModel).mockReturnValue({
                ...vmDefaultValues,
                isDirectMessage: true,
                userStatus: { emoji: "💬", text: "In a meeting" },
            });

            getComponent();

            expect(screen.getByText("In a meeting")).toBeInTheDocument();
            expect(screen.getByText("💬")).toBeInTheDocument();
        });

        it("does not show a status when there is none", () => {
            vi.mocked(useRoomSummaryCardViewModel).mockReturnValue({
                ...vmDefaultValues,
                isDirectMessage: true,
                userStatus: undefined,
            });

            getComponent();

            expect(screen.queryByText("In a meeting")).not.toBeInTheDocument();
        });
    });

    describe("in the Telegram-style layout", () => {
        beforeEach(() => {
            telegram = true;
            room.name = "Fox den";
        });

        it("lays the group out like tweb's profile: header, info rows, then members, shared media and actions tabs", () => {
            vi.mocked(useRoomSummaryCardViewModel).mockReturnValue({ ...vmDefaultValues, alias: "#den:domain.org" });
            getComponent();

            const profile = screen.getByTestId("tg-profile");
            expect(profile.querySelector(".mx_TgProfile_name")?.textContent).toBe("Fox den");
            expect(screen.getByText("#den:domain.org")).toBeInTheDocument();
            expect(screen.getByText("Address")).toBeInTheDocument();
            expect(screen.getByText("Link")).toBeInTheDocument();
            expect(screen.getByRole("switch", { name: "Notifications" })).toBeInTheDocument();

            const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
            expect(tabs).toEqual(["Members", "Media", "Files", "Links", "Music", "Voice", "Actions"]);
            expect(screen.getByRole("tab", { name: "Members" })).toHaveAttribute("aria-selected", "true");
            // Element's summary layout is not rendered.
            expect(screen.queryByText("Public room")).not.toBeInTheDocument();
        });

        it("keeps Element's room actions under the actions tab", () => {
            getComponent();
            expect(screen.queryByRole("menuitem", { name: "Settings" })).not.toBeInTheDocument();
            fireEvent.click(screen.getByRole("tab", { name: "Actions" }));
            fireEvent.click(screen.getByRole("menuitem", { name: "Settings" }));
            expect(vmDefaultValues.onRoomSettingsClick).toHaveBeenCalled();
        });

        it("shows the shared media right in the profile instead of linking to the files panel", () => {
            getComponent();
            fireEvent.click(screen.getByRole("tab", { name: "Files" }));
            expect(screen.queryByRole("button", { name: "Open files" })).not.toBeInTheDocument();
            expect(document.querySelector(".mx_SharedMedia_content_files")).toBeInTheDocument();
        });

        it("has no members tab for a DM and opens on media", () => {
            vi.mocked(useRoomSummaryCardViewModel).mockReturnValue({ ...vmDefaultValues, isDirectMessage: true });
            getComponent();
            expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
                "Media",
                "Files",
                "Links",
                "Music",
                "Voice",
                "Actions",
            ]);
            expect(screen.getByRole("tab", { name: "Media" })).toHaveAttribute("aria-selected", "true");
        });
    });
});
