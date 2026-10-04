/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "test-utils-rtl";

import { PillTabs, type PillTab } from "./PillTabs";

const TABS: PillTab<string | null>[] = [
    { value: null, label: "All" },
    { value: "people", label: "People" },
    { value: "messages", label: "Messages" },
];

function renderTabs(active: string | null, onChange = vi.fn()): ReturnType<typeof vi.fn> {
    render(<PillTabs tabs={TABS} active={active} onChange={onChange} aria-label="Search filters" />);
    return onChange;
}

describe("PillTabs", () => {
    it("marks the active tab selected and makes it the strip's only Tab stop", () => {
        renderTabs("people");

        expect(screen.getByRole("tablist", { name: "Search filters" })).toBeInTheDocument();
        const tabs = screen.getAllByRole("tab");
        expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
        expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0, -1]);
    });

    it("chooses a tab when it is pressed", () => {
        const onChange = renderTabs(null);
        fireEvent.click(screen.getByRole("tab", { name: "Messages" }));
        expect(onChange).toHaveBeenCalledWith("messages");
    });

    it.each([
        ["ArrowRight", "people", "messages"],
        ["ArrowRight", "messages", null],
        ["ArrowLeft", null, "messages"],
        ["Home", "messages", null],
        ["End", null, "messages"],
    ])("%s from %s chooses %s", (key, from, to) => {
        const onChange = renderTabs(from);
        fireEvent.keyDown(screen.getByRole("tab", { selected: true }), { key });
        expect(onChange).toHaveBeenCalledWith(to);
    });

    it("leaves other keys alone", () => {
        const onChange = renderTabs(null);
        fireEvent.keyDown(screen.getByRole("tab", { selected: true }), { key: "ArrowDown" });
        expect(onChange).not.toHaveBeenCalled();
    });
});
