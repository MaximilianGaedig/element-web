/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { render, screen } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, afterEach } from "vitest";

import { RoomListPill } from "./RoomListPill";
import { roomListPanelView, setRoomListPanelView } from "../../../../utils/roomListPanelView";
import { clearSearch, panelSearch } from "../../../../utils/panelSearch";

afterEach(() => {
    setRoomListPanelView("rooms");
    clearSearch();
});

describe("RoomListPill", () => {
    it("names every view it can move between, rather than only drawing an icon for it", () => {
        render(<RoomListPill />);
        expect(screen.getByRole("navigation", { name: "Chats, people and calls" })).toBeInTheDocument();
        for (const name of ["Messages", "People", "Calls", "Search"]) {
            expect(screen.getByRole("button", { name })).toBeInTheDocument();
        }
    });

    it("marks the view being shown, so the bar says where you are and not only where you can go", async () => {
        render(<RoomListPill />);
        expect(screen.getByRole("button", { name: "Messages" })).toHaveAttribute("aria-current", "page");

        await userEvent.click(screen.getByRole("button", { name: "Calls" }));
        expect(roomListPanelView()).toBe("calls");
        expect(screen.getByRole("button", { name: "Calls" })).toHaveAttribute("aria-current", "page");
        expect(screen.getByRole("button", { name: "Messages" })).not.toHaveAttribute("aria-current");
    });

    it("puts the people in the panel", async () => {
        render(<RoomListPill />);
        await userEvent.click(screen.getByRole("button", { name: "People" }));
        expect(roomListPanelView()).toBe("contacts");
    });

    /*
     * Searching is a state of the bar, not a fourth place to be: pressing it turns the pill into the field
     * rather than moving the reader somewhere, so nothing is marked as current and what was showing still is.
     */
    it("turns into a search field without changing which view you are in", async () => {
        render(<RoomListPill />);
        expect(screen.getByRole("button", { name: "Messages" })).toHaveAttribute("aria-current", "page");

        await userEvent.click(screen.getByRole("button", { name: "Search" }));
        expect(panelSearch().open).toBe(true);
        expect(roomListPanelView()).toBe("rooms");
        // The field is there and takes what is typed, for whichever list is showing.
        await userEvent.type(screen.getByRole("searchbox"), "ada");
        expect(panelSearch().query).toBe("ada");
    });

    /* A query against one list means nothing against the next, so changing view puts it away. */
    it("clears the search when the column changes what it is showing", async () => {
        render(<RoomListPill />);
        await userEvent.click(screen.getByRole("button", { name: "Search" }));
        await userEvent.type(screen.getByRole("searchbox"), "ada");

        await userEvent.click(screen.getByRole("button", { name: "Calls" }));
        expect(panelSearch()).toEqual({ open: false, query: "" });
    });
});
