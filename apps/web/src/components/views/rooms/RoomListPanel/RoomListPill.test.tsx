/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { render, screen } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, afterEach, vi } from "vitest";

import { RoomListPill } from "./RoomListPill";
import { roomListPanelView, setRoomListPanelView } from "../../../../utils/roomListPanelView";
import { clearSearch, panelSearch } from "../../../../utils/panelSearch";
import defaultDispatcher from "../../../../dispatcher/dispatcher";
import { Action } from "../../../../dispatcher/actions";
import { isAddingContact, setAddingContact } from "../../../../utils/contacts/adding";

afterEach(() => {
    setRoomListPanelView("rooms");
    clearSearch();
    setAddingContact(false);
    vi.restoreAllMocks();
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

    /* Over the chats, search is the app's own search (the Ctrl+K dialog), not a filter of the list. */
    it("opens the app's search over the chats, without turning into a field", async () => {
        const fire = vi.spyOn(defaultDispatcher, "fire");
        render(<RoomListPill />);
        await userEvent.click(screen.getByRole("button", { name: "Search" }));
        expect(fire).toHaveBeenCalledWith(Action.OpenSpotlight);
        expect(panelSearch().open).toBe(false);
        expect(screen.queryByRole("searchbox")).toBeNull();
    });

    /*
     * Over people and calls, searching is a state of the bar, not a fourth place to be: the button turns
     * into the field rather than moving the reader somewhere, and what was showing still is.
     */
    it("turns into a search field over people without changing which view you are in", async () => {
        const fire = vi.spyOn(defaultDispatcher, "fire");
        setRoomListPanelView("contacts");
        render(<RoomListPill />);

        await userEvent.click(screen.getByRole("button", { name: "Search" }));
        expect(panelSearch().open).toBe(true);
        expect(roomListPanelView()).toBe("contacts");
        expect(fire).not.toHaveBeenCalledWith(Action.OpenSpotlight);
        await userEvent.type(screen.getByRole("searchbox"), "ada");
        expect(panelSearch().query).toBe("ada");

        await userEvent.click(screen.getByRole("button", { name: "Close" }));
        expect(panelSearch()).toEqual({ open: false, query: "" });
    });

    /* Adding somebody is a thing to do among people, not among chats or calls. */
    it("offers + over people only, and it opens the editor", async () => {
        render(<RoomListPill />);
        expect(screen.queryByRole("button", { name: "Add a contact" })).toBeNull();
        await userEvent.click(screen.getByRole("button", { name: "Calls" }));
        expect(screen.queryByRole("button", { name: "Add a contact" })).toBeNull();

        await userEvent.click(screen.getByRole("button", { name: "People" }));
        await userEvent.click(screen.getByRole("button", { name: "Add a contact" }));
        expect(isAddingContact()).toBe(true);
    });

    it("puts search before the pill and + after it", () => {
        setRoomListPanelView("contacts");
        render(<RoomListPill />);
        const order = [...document.querySelectorAll(".mx_RoomListPill_bar > *")].map((el) => el.className);
        expect(order[0]).toContain("mx_RoomListPill_find");
        expect(order[1]).toContain("mx_RoomListPill");
        expect(order[2]).toContain("mx_RoomListPill_add");
    });

    it("can leave search out entirely", () => {
        render(<RoomListPill canSearch={false} />);
        expect(screen.queryByRole("button", { name: "Search" })).toBeNull();
    });

    /* A query against one list means nothing against the next, so changing view puts it away. */
    it("clears the search when the column changes what it is showing", async () => {
        setRoomListPanelView("contacts");
        render(<RoomListPill />);
        await userEvent.click(screen.getByRole("button", { name: "Search" }));
        await userEvent.type(screen.getByRole("searchbox"), "ada");

        await userEvent.click(screen.getByRole("button", { name: "Calls" }));
        expect(panelSearch()).toEqual({ open: false, query: "" });
    });
});
