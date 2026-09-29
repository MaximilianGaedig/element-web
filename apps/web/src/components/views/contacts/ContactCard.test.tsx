/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { render, screen } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ContactCard } from "./ContactCard";
import { type Person } from "../../../utils/contacts/people";

const person = (over: Partial<Person> = {}): Person => ({
    id: "tel:+49170",
    name: "Ada Klein",
    accounts: [
        { network: "Signal", mxid: "@signal_ada:e", remoteId: "ada", keys: ["tel:+49170"], roomId: "!sig:e" },
        { network: "WhatsApp", mxid: "@wa_ada:e", remoteId: "49170", keys: ["tel:+49170"] },
    ],
    keys: ["tel:+49170"],
    rooms: ["!sig:e"],
    saved: true,
    ...over,
});

describe("ContactCard", () => {
    it("says which networks the person is on, which is why they are one row", () => {
        render(<ContactCard person={person()} onBack={() => {}} onMessage={() => {}} />);
        expect(screen.getByRole("heading", { name: "Ada Klein" })).toBeInTheDocument();
        expect(screen.getByText("Signal")).toBeInTheDocument();
        expect(screen.getByText("WhatsApp")).toBeInTheDocument();
        // The number that made them one person, without its scheme.
        expect(screen.getByText("+49170")).toBeInTheDocument();
    });

    it("opens the chat on the network whose row was used", async () => {
        const onMessage = vi.fn();
        render(<ContactCard person={person()} onBack={() => {}} onMessage={onMessage} />);
        await userEvent.click(screen.getByRole("button", { name: /WhatsApp/ }));
        expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ name: "Ada Klein" }), "@wa_ada:e");
    });

    it("offers no call where no chat exists to hold one", () => {
        const onCall = vi.fn();
        render(<ContactCard person={person({ rooms: [] })} onBack={() => {}} onMessage={() => {}} onCall={onCall} />);
        expect(screen.queryByRole("button", { name: "Voice call" })).not.toBeInTheDocument();
    });

    it("shows the name the reader gave them, with the network's own beneath it", () => {
        render(
            <ContactCard person={person()} onBack={() => {}} onMessage={() => {}} nickname="Mum" onRename={() => {}} />,
        );
        expect(screen.getByRole("heading", { name: "Mum" })).toBeInTheDocument();
        expect(screen.getByText("Ada Klein")).toBeInTheDocument();
    });

    it("renames on submit, and says nothing on cancel", async () => {
        const onRename = vi.fn();
        render(<ContactCard person={person()} onBack={() => {}} onMessage={() => {}} onRename={onRename} />);

        await userEvent.click(screen.getByRole("button", { name: "Rename" }));
        const field = screen.getByRole("textbox");
        await userEvent.clear(field);
        await userEvent.type(field, "Mum");
        await userEvent.click(screen.getByRole("button", { name: "Save" }));
        expect(onRename).toHaveBeenCalledWith(expect.objectContaining({ id: "tel:+49170" }), "Mum");

        onRename.mockClear();
        await userEvent.click(screen.getByRole("button", { name: "Rename" }));
        await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
        expect(onRename).not.toHaveBeenCalled();
    });

    it("offers to separate only a merge the reader made", () => {
        const { rerender } = render(<ContactCard person={person()} onBack={() => {}} onMessage={() => {}} />);
        expect(screen.queryByRole("button", { name: "Separate" })).not.toBeInTheDocument();
        rerender(<ContactCard person={person()} onBack={() => {}} onMessage={() => {}} onSeparate={() => {}} />);
        expect(screen.getByRole("button", { name: "Separate" })).toBeInTheDocument();
    });
});
