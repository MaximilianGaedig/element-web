/*
Copyright 2024 New Vector Ltd.
Copyright 2024 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "test-utils-rtl";

import RoomSearchAuxPanel from "./RoomSearchAuxPanel";
import { SearchScope } from "../../../Searching";
import SettingsStore from "../../../settings/SettingsStore";
import { SDKContext } from "../../../contexts/SDKContext";
import { SDKContextClass } from "../../../contexts/SDKContextClass";

const roomSearchInfo = {
    searchId: 1234,
    count: 5,
    term: "abcd",
    roomId: "!room:example.org",
    scope: SearchScope.Room,
    promise: new Promise<never>(() => {}),
};

describe("RoomSearchAuxPanel", () => {
    it("should render the count of results", () => {
        render(
            <RoomSearchAuxPanel
                searchInfo={{
                    searchId: 1234,
                    count: 5,
                    term: "abcd",
                    scope: SearchScope.Room,
                    promise: new Promise(() => {}),
                }}
                isRoomEncrypted={false}
                onSearchScopeChange={vi.fn()}
                onCancelClick={vi.fn()}
            />,
        );

        expect(screen.getByText("5 results found for", { exact: false })).toHaveTextContent(
            "5 results found for “abcd”",
        );
    });

    describe("the jump-to-date button", () => {
        function renderWithStores(ui: React.ReactElement): void {
            render(<SDKContext.Provider value={new SDKContextClass()}>{ui}</SDKContext.Provider>);
        }

        function withJumpToDate(enabled: boolean): void {
            vi.spyOn(SettingsStore, "getValue").mockImplementation(
                (name) => name === "feature_jump_to_date" && enabled,
            );
        }

        it("is offered for a single room's results", () => {
            withJumpToDate(true);
            renderWithStores(
                <RoomSearchAuxPanel
                    searchInfo={roomSearchInfo}
                    isRoomEncrypted={false}
                    onSearchScopeChange={vi.fn()}
                    onCancelClick={vi.fn()}
                />,
            );
            expect(screen.getByRole("button", { name: "Scroll to date" })).toBeInTheDocument();
        });

        it("is not offered across all rooms, where a date has no one history to look in", () => {
            withJumpToDate(true);
            renderWithStores(
                <RoomSearchAuxPanel
                    searchInfo={{ ...roomSearchInfo, scope: SearchScope.All }}
                    isRoomEncrypted={false}
                    onSearchScopeChange={vi.fn()}
                    onCancelClick={vi.fn()}
                />,
            );
            expect(screen.queryByRole("button", { name: "Scroll to date" })).not.toBeInTheDocument();
        });

        it("is not offered when the homeserver cannot look an event up by date", () => {
            withJumpToDate(false);
            renderWithStores(
                <RoomSearchAuxPanel
                    searchInfo={roomSearchInfo}
                    isRoomEncrypted={false}
                    onSearchScopeChange={vi.fn()}
                    onCancelClick={vi.fn()}
                />,
            );
            expect(screen.queryByRole("button", { name: "Scroll to date" })).not.toBeInTheDocument();
        });
    });

    it("should allow the user to toggle to all rooms search", async () => {
        const onSearchScopeChange = vi.fn();

        render(
            <RoomSearchAuxPanel
                isRoomEncrypted={false}
                onSearchScopeChange={onSearchScopeChange}
                onCancelClick={vi.fn()}
            />,
        );

        screen.getByText("Search all rooms").click();
        expect(onSearchScopeChange).toHaveBeenCalledWith(SearchScope.All);
    });

    it("should allow the user to toggle back to room-specific search", async () => {
        const onSearchScopeChange = vi.fn();

        render(
            <RoomSearchAuxPanel
                searchInfo={{
                    searchId: 1234,
                    term: "abcd",
                    scope: SearchScope.All,
                    promise: new Promise(() => {}),
                }}
                isRoomEncrypted={false}
                onSearchScopeChange={onSearchScopeChange}
                onCancelClick={vi.fn()}
            />,
        );

        screen.getByText("Search this room").click();
        expect(onSearchScopeChange).toHaveBeenCalledWith(SearchScope.Room);
    });

    it("should allow the user to cancel a search", async () => {
        const onCancelClick = vi.fn();

        render(
            <RoomSearchAuxPanel isRoomEncrypted={false} onSearchScopeChange={vi.fn()} onCancelClick={onCancelClick} />,
        );

        screen.getByRole("button", { name: "Cancel" }).click();
        expect(onCancelClick).toHaveBeenCalled();
    });
});
