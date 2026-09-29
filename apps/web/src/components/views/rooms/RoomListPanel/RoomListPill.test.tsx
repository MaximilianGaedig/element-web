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
import { contactsTab } from "../../../../utils/contacts/contactsTab";

afterEach(() => setRoomListPanelView("rooms"));

describe("RoomListPill", () => {
    it("offers the three whole-list actions", () => {
        render(<RoomListPill />);
        expect(screen.getByRole("toolbar", { name: "Everything in this list" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "People" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Calls" })).toBeInTheDocument();
    });

    it("puts contacts in the panel, on the people list", async () => {
        render(<RoomListPill />);
        await userEvent.click(screen.getByRole("button", { name: "People" }));
        expect(roomListPanelView()).toBe("contacts");
        expect(contactsTab()).toBe("people");
    });

    it("opens the calls list when that is the one asked for", async () => {
        render(<RoomListPill />);
        await userEvent.click(screen.getByRole("button", { name: "Calls" }));
        expect(roomListPanelView()).toBe("contacts");
        expect(contactsTab()).toBe("calls");
    });
});
