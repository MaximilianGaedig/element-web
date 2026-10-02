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
import { lowPower } from "../../lowPower";

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

    /* The stylesheets' hook existed and nothing ever set it: neither the device nor the reader could. */
    it("says on the document when power is being saved, by the device or by the reader's choice", async () => {
        render(<AppearanceAttributes />);
        expect(document.documentElement).not.toHaveAttribute("data-low-power");

        // The device: a battery on its last tenth.
        act(() => lowPower.report({ battery: { level: 0.1, charging: false } }));
        expect(document.documentElement).toHaveAttribute("data-low-power", "true");
        // What plays by itself does not, while it is on, whatever it is set to.
        await act(async () => {
            await SettingsStore.setValue("autoplayGifs", null, SettingLevel.DEVICE, true);
        });
        expect(SettingsStore.getValue("autoplayGifs")).toBe(false);
        expect(SettingsStore.getValue("showChatEffects")).toBe(false);

        // The reader: never.
        await act(async () => {
            await SettingsStore.setValue("lowPowerMode", null, SettingLevel.DEVICE, "off");
        });
        expect(document.documentElement).not.toHaveAttribute("data-low-power");
        expect(SettingsStore.getValue("autoplayGifs")).toBe(true);
        expect(SettingsStore.getValue("showChatEffects")).toBe(true);

        // The reader: always, on a device with nothing to say.
        act(() => lowPower.report({ battery: { level: 1, charging: true } }));
        await act(async () => {
            await SettingsStore.setValue("lowPowerMode", null, SettingLevel.DEVICE, "on");
        });
        expect(document.documentElement).toHaveAttribute("data-low-power", "true");

        await act(async () => {
            await SettingsStore.setValue("lowPowerMode", null, SettingLevel.DEVICE, "auto");
            await SettingsStore.setValue("autoplayGifs", null, SettingLevel.DEVICE, false);
        });
        act(() => lowPower.reset());
        expect(document.documentElement).not.toHaveAttribute("data-low-power");
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
