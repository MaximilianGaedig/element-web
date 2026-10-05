/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type WallpaperPreset, type WallpaperProvider } from "./WallpaperProvider";
import { twebWallpaperProvider } from "./twebWallpaperProvider";

/** Every wallpaper source, in the order a picker lists them. Another source is one more entry here. */
export const WALLPAPER_PROVIDERS: WallpaperProvider[] = [twebWallpaperProvider];

/** A stored wallpaper reference: `<provider id>:<preset id>`. */
export type WallpaperRef = string;

/** The reference the setting stores for a provider's preset. */
export function wallpaperRef(provider: WallpaperProvider, preset: WallpaperPreset): WallpaperRef {
    return `${provider.id}:${preset.id}`;
}

/** The provider and preset id a reference names, or undefined if no provider has that id. */
export function resolveWallpaper(
    ref: WallpaperRef | null | undefined,
    providers: WallpaperProvider[] = WALLPAPER_PROVIDERS,
): { provider: WallpaperProvider; presetId: string } | undefined {
    if (!ref) return undefined;
    const split = ref.indexOf(":");
    if (split < 0) return undefined;
    const provider = providers.find((p) => p.id === ref.slice(0, split));
    return provider && { provider, presetId: ref.slice(split + 1) };
}
