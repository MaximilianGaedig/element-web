/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "test-utils-rtl";

import dis from "../../../dispatcher/dispatcher";
import SettingsStore from "../../../settings/SettingsStore";
import { SettingLevel } from "../../../settings/SettingLevel";
import ThemeWatcher from "../../../settings/watchers/ThemeWatcher";
import { WALLPAPER_PROVIDERS } from "../../../utils/wallpaper/wallpaperProviders";
import { type WallpaperProvider } from "../../../utils/wallpaper/WallpaperProvider";
import { ChatWallpaperPanel } from "../settings/ChatWallpaperPanel";
import { lowPower } from "../../../utils/lowPower";
import { RoomChatWallpaper } from "./ChatWallpaper";

// tweb's renderer draws on a 2D canvas, which the test DOM does not have.
vi.mock("tweb/src/components/chat/gradientRenderer", () => ({
    default: {
        create: () => ({
            gradientRenderer: { toNextPosition: () => {}, cleanup: () => {} },
            canvas: document.createElement("canvas"),
        }),
    },
}));

const onMessageSent = vi.fn();
const destroy = vi.fn();
const fake: WallpaperProvider = {
    id: "fake",
    presets: () => [
        { id: "day", dark: false },
        { id: "night", dark: true },
    ],
    mount: vi.fn((host: HTMLElement, presetId: string) => {
        host.dataset.preset = presetId;
        return { onMessageSent, destroy };
    }),
};

let wallpaper: { light: string | null; dark: string | null };
let theme: string;

describe("ChatWallpaper", () => {
    beforeEach(() => {
        WALLPAPER_PROVIDERS.unshift(fake);
        wallpaper = { light: null, dark: null };
        theme = "light";
        vi.spyOn(ThemeWatcher.prototype, "getEffectiveTheme").mockImplementation(() => theme);
        const getValue = SettingsStore.getValue.bind(SettingsStore);
        vi.spyOn(SettingsStore, "getValue").mockImplementation(((name: string, ...rest: unknown[]) =>
            name === "chatWallpaper" ? wallpaper : (getValue as any)(name, ...rest)) as any);
    });

    afterEach(() => {
        WALLPAPER_PROVIDERS.splice(WALLPAPER_PROVIDERS.indexOf(fake), 1);
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    it("draws the wallpaper chosen for the theme being shown, and turns it when a message is sent", () => {
        wallpaper = { light: "fake:day", dark: "fake:night" };
        const { container, unmount } = render(<RoomChatWallpaper />);

        const host = container.querySelector<HTMLElement>(".mx_ChatWallpaper")!;
        expect(host.dataset.preset).toBe("day");
        act(() => dis.dispatch({ action: "message_sent" }, true));
        expect(onMessageSent).toHaveBeenCalledTimes(1);

        unmount();
        expect(destroy).toHaveBeenCalled();
    });

    it("stays still when a message is sent while saving power", () => {
        vi.spyOn(lowPower, "isOn").mockReturnValue(true);
        wallpaper = { light: "fake:day", dark: null };
        render(<RoomChatWallpaper />);
        act(() => dis.dispatch({ action: "message_sent" }, true));
        expect(onMessageSent).not.toHaveBeenCalled();
    });

    it("draws the dark theme's own wallpaper", () => {
        theme = "dark";
        wallpaper = { light: "fake:day", dark: "fake:night" };
        const { container } = render(<RoomChatWallpaper />);
        expect(container.querySelector<HTMLElement>(".mx_ChatWallpaper")!.dataset.preset).toBe("night");
    });

    it("draws nothing without a wallpaper", () => {
        const { container } = render(<RoomChatWallpaper />);
        expect(container.querySelector(".mx_ChatWallpaper")).toBeNull();
        expect(fake.mount).not.toHaveBeenCalled();
    });

    it("lists the theme's wallpapers and stores a pick for that theme only", () => {
        wallpaper = { light: null, dark: "fake:night" };
        const setValue = vi.spyOn(SettingsStore, "setValue").mockResolvedValue(undefined);
        render(<ChatWallpaperPanel />);

        expect(screen.getByRole("radio", { name: "None" })).toBeChecked();
        // The light theme's: the fake's one, then tweb's seven Day Classic wallpapers.
        expect(screen.getAllByRole("radio")).toHaveLength(1 + 1 + 7);
        fireEvent.click(screen.getByRole("radio", { name: "Wallpaper 1" }));
        expect(setValue).toHaveBeenCalledWith("chatWallpaper", null, SettingLevel.ACCOUNT, {
            light: "fake:day",
            dark: "fake:night",
        });
    });
});
