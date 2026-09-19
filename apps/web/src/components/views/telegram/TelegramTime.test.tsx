/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "test-utils-rtl";

import TelegramTime from "./TelegramTime";

describe("<TelegramTime />", () => {
    it("renders the time with tweb's status glyph after it", () => {
        const { container } = render(
            <TelegramTime timestamp={<span className="ts">12:34</span>} sendState="sent" placement="inline" />,
        );
        const time = container.querySelector(".mx_TelegramTime")!;
        expect(time).not.toHaveClass("mx_TelegramTime_floating");
        expect(time.textContent).toBe("12:34");
        const status = time.querySelector(".mx_TelegramTime_status")!;
        expect(status).toHaveAttribute("data-state", "sent");
        expect(status).toHaveAttribute("aria-label", "Your message was sent");
        // Status after the time in the DOM too, like tweb's order: 5.
        expect(time.lastElementChild).toBe(status);
    });

    it("draws two ticks for delivered and read", () => {
        const { container, rerender } = render(
            <TelegramTime timestamp="12:34" sendState="delivered" placement="inline" />,
        );
        const pathOf = () => container.querySelector(".mx_TelegramTime_status path")!.getAttribute("d");
        const delivered = pathOf();
        rerender(<TelegramTime timestamp="12:34" sendState="read" placement="inline" />);
        expect(pathOf()).toBe(delivered);
        rerender(<TelegramTime timestamp="12:34" sendState="sent" placement="inline" />);
        expect(pathOf()).not.toBe(delivered);
    });

    it("has no status on other people's messages and floats over media", () => {
        const { container } = render(<TelegramTime timestamp="12:34" placement="floating" />);
        expect(container.querySelector(".mx_TelegramTime")).toHaveClass("mx_TelegramTime_floating");
        expect(container.querySelector(".mx_TelegramTime_status")).toBeNull();
    });
});
