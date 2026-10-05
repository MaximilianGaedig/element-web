/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The wallpapers every Telegram app ships, from tweb (Telegram Web K, GPL-3.0) used as a library: its Telegram iOS
 * theme presets and its one bundled doodle pattern are imported, not copied, and drawn by telegramLayers.ts. The
 * account's own wallpapers, with Telegram's other patterns, come from the bridge (telegramWallpaperProvider.ts).
 */

import { getAccentPresetsForBase, presetToThemeSettings, type BaseThemeName } from "tweb/src/config/themePresets";
import { getColorsFromWallPaper } from "tweb/src/helpers/color";
import patternUrl from "tweb/public/assets/img/pattern.svg";

import { type MountedWallpaper, type WallpaperPreset, type WallpaperProvider } from "./WallpaperProvider";
import { mountTelegramWallpaper, type PatternMode } from "./telegramLayers";

interface TwebPreset extends WallpaperPreset {
    colors: string;
    /** 0..1: how strongly the pattern (or, masked, the gradient) shows. */
    intensity: number;
    pattern: PatternMode;
}

const BASES: { base: BaseThemeName; key: string; dark: boolean; pattern: PatternMode }[] = [
    { base: "baseThemeClassic", key: "classic", dark: false, pattern: "soft-light" },
    { base: "baseThemeNight", key: "night", dark: true, pattern: "mask" },
    { base: "baseThemeTinted", key: "tinted", dark: true, pattern: "inverted" },
];

let presets: TwebPreset[] | undefined;

function twebPresets(): TwebPreset[] {
    presets ??= BASES.flatMap(({ base, key, dark, pattern }) =>
        getAccentPresetsForBase(base)
            .filter((preset) => preset.wallpaper)
            .map((preset) => {
                const wallpaper = presetToThemeSettings(preset, base).wallpaper;
                return {
                    id: `${key}-${preset.id}`,
                    dark,
                    colors: getColorsFromWallPaper(wallpaper),
                    intensity: Math.abs(wallpaper?.settings?.intensity ?? 0) / 100,
                    pattern,
                };
            }),
    );
    return presets;
}

/** Telegram's wallpapers: an animated four-colour gradient under its doodle pattern. */
export const twebWallpaperProvider: WallpaperProvider = {
    id: "tweb",
    presets: twebPresets,
    mount(host: HTMLElement, presetId: string, options?: { swatch?: boolean }): MountedWallpaper | undefined {
        const preset = twebPresets().find((p) => p.id === presetId);
        if (!preset) return undefined;

        return mountTelegramWallpaper(
            host,
            {
                colors: preset.colors,
                intensity: preset.intensity,
                pattern: { url: patternUrl, mode: preset.pattern },
            },
            options?.swatch,
        );
    },
};
