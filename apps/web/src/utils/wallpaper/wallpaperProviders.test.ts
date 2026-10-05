/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { resolveWallpaper, wallpaperRef } from "./wallpaperProviders";
import { type WallpaperProvider } from "./WallpaperProvider";

const solid: WallpaperProvider = { id: "solid", presets: () => [], mount: () => undefined };
const other: WallpaperProvider = { id: "other", presets: () => [], mount: () => undefined };

describe("wallpaper references", () => {
    it("name a provider and one of its presets, and resolve back to them", () => {
        const ref = wallpaperRef(other, { id: "a:b", dark: false });
        expect(ref).toBe("other:a:b");
        expect(resolveWallpaper(ref, [solid, other])).toEqual({ provider: other, presetId: "a:b" });
    });

    it("resolve to nothing for no wallpaper or an unknown provider", () => {
        expect(resolveWallpaper(null, [solid])).toBeUndefined();
        expect(resolveWallpaper("gone:1", [solid])).toBeUndefined();
        expect(resolveWallpaper("solid", [solid])).toBeUndefined();
    });
});
