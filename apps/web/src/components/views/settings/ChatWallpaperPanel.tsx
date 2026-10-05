/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useEffect } from "react";

import { _t } from "../../../languageHandler";
import SettingsStore from "../../../settings/SettingsStore";
import { SettingLevel } from "../../../settings/SettingLevel";
import { useSettingValue } from "../../../hooks/useSettings";
import { ChatWallpaper, useChatWallpaper, useWallpapersVersion } from "../telegram/ChatWallpaper";
import { WALLPAPER_PROVIDERS, wallpaperRef, type WallpaperRef } from "../../../utils/wallpaper/wallpaperProviders";
import { SettingsSubsection } from "./shared/SettingsSubsection";

/**
 * Picks the chat wallpaper for the theme being shown (light and dark keep one each, as on Telegram): every
 * provider's wallpapers for that kind of theme, each drawn as itself, and the theme's plain background.
 */
export function ChatWallpaperPanel(): JSX.Element {
    const { wallpaper: current, dark } = useChatWallpaper();
    const setting = useSettingValue("chatWallpaper");
    useWallpapersVersion();
    // Providers that have to ask for their wallpapers (the Telegram account's, through its bridge) ask now.
    useEffect(() => {
        for (const provider of WALLPAPER_PROVIDERS) provider.load?.();
    }, []);
    const choices = WALLPAPER_PROVIDERS.flatMap((provider) =>
        provider
            .presets()
            .filter((preset) => preset.dark === undefined || preset.dark === dark)
            .map((preset) => wallpaperRef(provider, preset)),
    );

    const choose = (wallpaper: WallpaperRef | null): void => {
        void SettingsStore.setValue("chatWallpaper", null, SettingLevel.ACCOUNT, {
            light: setting?.light ?? null,
            dark: setting?.dark ?? null,
            [dark ? "dark" : "light"]: wallpaper,
        });
    };

    return (
        <SettingsSubsection heading={_t("settings|chat_wallpaper")}>
            <div className="mx_ChatWallpaperPanel" role="radiogroup" aria-label={_t("settings|chat_wallpaper")}>
                <button
                    type="button"
                    role="radio"
                    aria-checked={!current}
                    className="mx_ChatWallpaperPanel_choice mx_ChatWallpaperPanel_none"
                    onClick={() => choose(null)}
                >
                    {_t("settings|chat_wallpaper_none")}
                </button>
                {choices.map((ref, i) => (
                    <button
                        key={ref}
                        type="button"
                        role="radio"
                        aria-checked={current === ref}
                        aria-label={_t("settings|chat_wallpaper_preset", { number: i + 1 })}
                        className="mx_ChatWallpaperPanel_choice"
                        onClick={() => choose(ref)}
                    >
                        <ChatWallpaper wallpaper={ref} swatch />
                    </button>
                ))}
            </div>
        </SettingsSubsection>
    );
}
