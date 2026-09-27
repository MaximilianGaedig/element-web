/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import React from "react";
import { act, render } from "test-utils-rtl";

import { AppearanceAttributes } from "./appearance";
import SettingsStore from "../../../settings/SettingsStore";
import { SettingLevel } from "../../../settings/SettingLevel";

describe("AppearanceAttributes", () => {
    it("says on the document which of the appearance settings are on", () => {
        const { unmount } = render(<AppearanceAttributes />);
        // All of them default on, which is the look the old single switch gave.
        expect(document.documentElement).toHaveAttribute("data-floating-bars", "true");
        expect(document.documentElement).toHaveAttribute("data-chat-columns", "true");
        expect(document.documentElement).toHaveAttribute("data-handheld-sheets", "true");
        unmount();
        expect(document.documentElement).not.toHaveAttribute("data-floating-bars");
    });

    it("follows the mobile message padding as it changes, and lets go on unmount", async () => {
        const { unmount } = render(<AppearanceAttributes />);
        expect(document.documentElement).toHaveAttribute("data-tg-message-padding", "telegram-ios");
        for (const preset of ["telegram-web", "element", "telegram-ios"] as const) {
            await act(async () => {
                await SettingsStore.setValue("mobileMessagePadding", null, SettingLevel.DEVICE, preset);
            });
            expect(document.documentElement).toHaveAttribute("data-tg-message-padding", preset);
        }
        unmount();
        expect(document.documentElement).not.toHaveAttribute("data-tg-message-padding");
    });

    it("drops a setting's attribute when it is turned off, leaving the others alone", async () => {
        render(<AppearanceAttributes />);
        await act(async () => {
            await SettingsStore.setValue("floatingBars", null, SettingLevel.DEVICE, false);
        });
        expect(document.documentElement).not.toHaveAttribute("data-floating-bars");
        // The point of the change: they are separate, so the rest stay as they were.
        expect(document.documentElement).toHaveAttribute("data-chat-columns", "true");
        await act(async () => {
            await SettingsStore.setValue("floatingBars", null, SettingLevel.DEVICE, true);
        });
        expect(document.documentElement).toHaveAttribute("data-floating-bars", "true");
    });
});
