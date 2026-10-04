/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/*
 * Styles are not applied in these tests, so what is checked is the stylesheet itself: that the list marks
 * hover and selected with the chat list's own two tokens (RoomListItemView.module.css), which is what keeps
 * the two apart - they were the same colour before.
 */
const css = readFileSync(new URL("../../../../res/css/views/settings/_UserSettingsPage.pcss", import.meta.url), "utf8");

const block = (selector: string): string => {
    const start = css.indexOf(selector);
    expect(start).toBeGreaterThan(-1);
    return css.slice(start, css.indexOf("\n    }", start));
};

describe("the settings list's rows", () => {
    it("tint on hover with the chat list's hover colour", () => {
        expect(block("&:hover")).toContain("--cpd-color-bg-action-tertiary-hovered");
    });

    it("are marked selected with the chat list's selected colour and its accent bar", () => {
        const selected = block('&[aria-selected="true"]');
        expect(selected).toContain("--cpd-color-bg-action-tertiary-selected");
        expect(selected).toContain("--cpd-color-bg-accent-rest");
    });

    it("give the selected row the last word, so it stays selected under the pointer", () => {
        expect(css.indexOf('&[aria-selected="true"]')).toBeGreaterThan(css.indexOf("&:hover"));
    });

    it("show a focus ring on the keyboard's focus", () => {
        expect(block("&:focus-visible")).toContain("--cpd-color-border-focused");
    });
});
