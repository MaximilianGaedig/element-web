/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { render, screen, within } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ContactEditor } from "./ContactEditor";
import { type ContactCard } from "../../../utils/contacts/card";

function renderEditor(card: ContactCard = {}) {
    const onSave = vi.fn();
    render(<ContactEditor card={card} onSave={onSave} onCancel={vi.fn()} />);
    return { onSave };
}

describe("ContactEditor", () => {
    /* iOS: a group with nothing in it is only its "add" row, and adding puts the caret in the new entry. */
    it("adds an entry with the green plus and focuses it", async () => {
        renderEditor();
        const phones = screen.getByRole("region", { name: "Phone" });
        expect(within(phones).queryByRole("textbox")).toBeNull();

        await userEvent.click(within(phones).getByRole("button", { name: "add phone" }));
        const field = within(phones).getByRole("textbox", { name: "Phone" });
        expect(field).toHaveFocus();
    });

    it("removes an entry with the red minus", async () => {
        const { onSave } = renderEditor({
            phones: [
                { label: "mobile", value: "+1" },
                { label: "work", value: "+2" },
            ],
        });
        const phones = screen.getByRole("region", { name: "Phone" });
        await userEvent.click(within(phones).getAllByRole("button", { name: "Remove Phone" })[0]);
        await userEvent.click(screen.getByRole("button", { name: "Save" }));
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ phones: [{ label: "work", value: "+2" }] }));
    });

    /* An entry added and left empty is not something to keep. */
    it("drops entries left empty when saving", async () => {
        const { onSave } = renderEditor({ firstName: "Ada" });
        await userEvent.click(screen.getByRole("button", { name: "add email" }));
        await userEvent.click(screen.getByRole("button", { name: "Save" }));
        const saved = onSave.mock.calls[0][0] as ContactCard;
        expect(saved.firstName).toBe("Ada");
        expect(saved.emails).toBeUndefined();
    });

    /* The rest of the name opens inside the name block, between first and last as iOS orders them. */
    it("opens the other name fields inside the name block", async () => {
        renderEditor();
        const name = screen.getByRole("region", { name: "Name" });
        expect(within(name).queryByRole("textbox", { name: "Middle name" })).toBeNull();

        await userEvent.click(within(name).getByRole("button", { name: "More name fields" }));
        const fields = within(name)
            .getAllByRole("textbox")
            .map((field) => field.getAttribute("aria-label"));
        expect(fields.indexOf("Middle name")).toBeGreaterThan(fields.indexOf("First name"));
        expect(fields.indexOf("Middle name")).toBeLessThan(fields.indexOf("Last name"));
    });
});
