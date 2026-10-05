/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/** What Element Web uses of tweb's Telegram iOS theme presets (src/config/themePresets.ts). */

/** tweb's base themes: Day Classic, Day, Night and Night Tinted ("Dark"). */
export type BaseThemeName = "baseThemeClassic" | "baseThemeDay" | "baseThemeNight" | "baseThemeTinted";

export interface AccentPresetWallpaper {
    /** 1..100: how strongly the pattern shows. */
    intensity: number;
    background_color: number;
    second_background_color?: number;
    third_background_color?: number;
    fourth_background_color?: number;
    dark?: boolean;
}

export interface AccentPreset {
    /** Telegram iOS' preset index, the same across platforms. */
    id: number;
    accent_color: number;
    message_colors: number[];
    wallpaper?: AccentPresetWallpaper;
}

/** The theme's wallpaper as Telegram's API would describe it; only what the colour helpers read. */
export interface PresetThemeSettings {
    wallpaper?: { settings?: { intensity?: number } };
}

export function getAccentPresetsForBase(base: BaseThemeName): AccentPreset[];
export function presetToThemeSettings(preset: AccentPreset, base: BaseThemeName): PresetThemeSettings;
