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

afterEach(() => setRoomListPanelView("rooms"));

describe("RoomListPill", () => {
    it("names every view it can move between, rather than only drawing an icon for it", () => {
        render(<RoomListPill />);
        expect(screen.getByRole("navigation", { name: "Chats, people and calls" })).toBeInTheDocument();
        for (const name of ["Messages", "People", "Calls"]) {
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

    /* Search opens over whatever is showing, so it is never somewhere to be. */
    it("never marks search as the view you are in", async () => {
        render(<RoomListPill />);
        expect(screen.getByRole("button", { name: "Found" })).not.toHaveAttribute("aria-current");
    });
});
