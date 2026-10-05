/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Telegram's chat wallpapers, from tweb (Telegram Web K, GPL-3.0) used as a library: its gradient renderer, its
 * Telegram iOS theme presets and its doodle pattern are imported, not copied. What is here is only how the layers
 * are put together, which in tweb lives in a Solid component tied to its theme store
 * (src/components/chat/bubbles/chatBackground.tsx).
 */

import ChatBackgroundGradientRenderer from "tweb/src/components/chat/gradientRenderer";
import { getAccentPresetsForBase, presetToThemeSettings, type BaseThemeName } from "tweb/src/config/themePresets";
import { getColorsFromWallPaper } from "tweb/src/helpers/color";
import patternUrl from "tweb/public/assets/img/pattern.svg";

import { type MountedWallpaper, type WallpaperPreset, type WallpaperProvider } from "./WallpaperProvider";

/**
 * How the doodle pattern sits on the gradient. Light themes lay it over the gradient in soft light; Night shows the
 * gradient only through the pattern, on black; Night Tinted ("Dark") lays a lightened pattern over its dark gradient.
 */
type PatternMode = "soft-light" | "mask" | "inverted";

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

        let created: ReturnType<typeof ChatBackgroundGradientRenderer.create>;
        try {
            created = ChatBackgroundGradientRenderer.create(preset.colors);
        } catch {
            // The renderer draws on a 2D canvas, which a browser may refuse (fingerprinting protection, no
            // memory); the chat is then left on the theme's background rather than failing with it.
            return undefined;
        }
        const { gradientRenderer, canvas } = created;
        canvas.className = "mx_ChatWallpaper_gradient";
        const pattern = document.createElement("div");
        pattern.className = `mx_ChatWallpaper_pattern mx_ChatWallpaper_pattern_${preset.pattern}`;
        // Set here, not through a custom property: a url() in one would resolve against the stylesheet.
        pattern.style.backgroundImage = `url("${patternUrl}")`;
        // A Night wallpaper is its colours seen through thin lines: at a swatch's size that is black. Show the colours.
        if (preset.pattern === "mask" && !options?.swatch) {
            // tweb dims the gradient that shows through the pattern, never below 0.3.
            canvas.style.opacity = String(Math.max(0.3, preset.intensity * 0.5));
            canvas.style.maskImage = `url("${patternUrl}")`;
            canvas.classList.add("mx_ChatWallpaper_gradient_masked");
            host.dataset.dark = "true";
            host.append(canvas);
        } else {
            pattern.style.opacity = String(preset.intensity);
            host.append(canvas, pattern);
        }
        return {
            onMessageSent: () => gradientRenderer.toNextPosition(),
            destroy: () => {
                gradientRenderer.cleanup();
                canvas.remove();
                pattern.remove();
                delete host.dataset.dark;
            },
        };
    },
};
