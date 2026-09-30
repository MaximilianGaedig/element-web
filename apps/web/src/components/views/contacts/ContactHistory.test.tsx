/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { render, screen } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ContactHistory } from "./ContactHistory";
import { type Revision } from "../../../utils/contacts/history";
import Modal from "../../../Modal";

const revision = (ts: number, was: Revision["was"]): Revision => ({ ts, source: "edit", was });

/** The dialog answers yes unless a test says otherwise, since the answering is not what is under test here. */
let answer = true;
beforeEach(() => {
    answer = true;
    vi.spyOn(Modal, "createDialog").mockImplementation(
        () => ({ finished: Promise.resolve([answer]), close: () => {} }) as ReturnType<typeof Modal.createDialog>,
    );
});

const history = [revision(2_000, { firstName: "Augusta", notes: "met at work" }), revision(1_000, {})];

function renderHistory(over: Partial<React.ComponentProps<typeof ContactHistory>> = {}) {
    const props = {
        history,
        card: { firstName: "Ada", notes: "met at work" },
        onRestore: vi.fn(),
        onDelete: vi.fn(),
        onEmpty: vi.fn(),
        ...over,
    };
    render(<ContactHistory {...props} />);
    return props;
}

describe("a contact's history", () => {
    it("lists a version per row, saying what is different about it", () => {
        renderHistory();
        const rows = screen.getAllByRole("button", { name: /show this version/i });
        expect(rows).toHaveLength(2);
        // The newer version differs from the card only in the name; the empty one differs in the note too.
        expect(rows[0].textContent).toMatch(/firstName/);
        expect(rows[0].textContent).not.toMatch(/notes/);
        expect(rows[1].textContent).toMatch(/notes/);
    });

    /*
     * The whole reason this is a panel and not a list of restore buttons: pressing a version used to overwrite
     * the card, which put an irreversible change to somebody's contact one stray tap away.
     */
    it("opens a version rather than restoring it", async () => {
        const { onRestore } = renderHistory();
        await userEvent.click(screen.getAllByRole("button", { name: /show this version/i })[0]);
        expect(onRestore).not.toHaveBeenCalled();
        expect(screen.getByText("Augusta")).toBeInTheDocument();
    });

    it("marks the lines of an opened version that differ from what the card says now", async () => {
        renderHistory();
        await userEvent.click(screen.getAllByRole("button", { name: /show this version/i })[0]);
        const changed = document.querySelectorAll("[data-changed]");
        expect(changed).toHaveLength(1);
        expect(changed[0].textContent).toContain("Augusta");
    });

    it("restores the opened version once the question is answered", async () => {
        const { onRestore } = renderHistory();
        await userEvent.click(screen.getAllByRole("button", { name: /show this version/i })[0]);
        await userEvent.click(screen.getByRole("button", { name: "Restore" }));
        expect(onRestore).toHaveBeenCalledWith(history[0]);
    });

    it("restores nothing when the question is answered no", async () => {
        answer = false;
        const { onRestore } = renderHistory();
        await userEvent.click(screen.getAllByRole("button", { name: /show this version/i })[0]);
        await userEvent.click(screen.getByRole("button", { name: "Restore" }));
        expect(onRestore).not.toHaveBeenCalled();
    });

    /* One version at a time, because the reason to prune is usually one particular version. */
    it("throws one version away and goes back to the list", async () => {
        const { onDelete } = renderHistory();
        await userEvent.click(screen.getAllByRole("button", { name: /show this version/i })[0]);
        await userEvent.click(screen.getByRole("button", { name: /delete this version/i }));
        expect(onDelete).toHaveBeenCalledWith(history[0]);
        expect(screen.getAllByRole("button", { name: /show this version/i })).toHaveLength(2);
    });

    it("empties the lot once the question is answered", async () => {
        const { onEmpty } = renderHistory();
        await userEvent.click(screen.getByRole("button", { name: /delete all versions/i }));
        expect(onEmpty).toHaveBeenCalled();
    });

    /* A version of an empty card is what "before any of this was typed" looks like, and is restorable. */
    it("shows a version that held nothing without pretending there is no history", async () => {
        renderHistory();
        await userEvent.click(screen.getAllByRole("button", { name: /show this version/i })[1]);
        expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
    });
});
