/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { twebWallpaperProvider } from "./twebWallpaperProvider";

const renderer = vi.hoisted(() => ({
    create: vi.fn(),
    toNextPosition: vi.fn(),
    cleanup: vi.fn(),
}));

// The renderer draws on a 2D canvas, which the test DOM does not have; the presets and colours are tweb's own.
vi.mock("tweb/src/components/chat/gradientRenderer", () => ({
    default: {
        create: (colors: string) => {
            renderer.create(colors);
            return {
                gradientRenderer: { toNextPosition: renderer.toNextPosition, cleanup: renderer.cleanup },
                canvas: document.createElement("canvas"),
            };
        },
    },
}));

describe("twebWallpaperProvider", () => {
    beforeEach(() => vi.clearAllMocks());

    it("offers tweb's Telegram iOS wallpapers: Day Classic's for light themes, Night's and Dark's for dark", () => {
        const presets = twebWallpaperProvider.presets();
        expect(presets.filter((p) => !p.dark).map((p) => p.id)).toEqual([
            "classic-106",
            "classic-102",
            "classic-104",
            "classic-101",
            "classic-107",
            "classic-103",
            "classic-105",
        ]);
        expect(presets.filter((p) => p.dark)).toHaveLength(3 + 9);
    });

    it("draws the gradient in the preset's colours under the doodle pattern, which answers a sent message", () => {
        const host = document.createElement("div");
        const mounted = twebWallpaperProvider.mount(host, "classic-106")!;

        expect(renderer.create).toHaveBeenCalledWith("#8dc0eb,#b9d1ea,#c6b1ef,#ebd7ef");
        const [canvas, pattern] = host.children as unknown as HTMLElement[];
        expect(canvas.tagName).toBe("CANVAS");
        expect(pattern.className).toContain("mx_ChatWallpaper_pattern_soft-light");
        expect(pattern.style.backgroundImage).toContain("pattern");
        expect(pattern.style.opacity).toBe("0.5");

        mounted.onMessageSent!();
        expect(renderer.toNextPosition).toHaveBeenCalledTimes(1);

        mounted.destroy();
        expect(host.children).toHaveLength(0);
        expect(renderer.cleanup).toHaveBeenCalled();
    });

    it("shows a Night gradient only through the pattern, on black", () => {
        const host = document.createElement("div");
        const mounted = twebWallpaperProvider.mount(host, "night-103")!;

        expect(host.dataset.dark).toBe("true");
        expect(host.children).toHaveLength(1);
        const canvas = host.children[0] as HTMLElement;
        expect(canvas.className).toContain("mx_ChatWallpaper_gradient_masked");
        expect(canvas.style.maskImage).toContain("pattern");

        mounted.destroy();
        expect(host.dataset.dark).toBeUndefined();
    });

    it("shows a Night wallpaper's colours in a swatch, where its thin lines alone would be black", () => {
        const host = document.createElement("div");
        twebWallpaperProvider.mount(host, "night-103", { swatch: true });
        expect(host.dataset.dark).toBeUndefined();
        expect((host.children[0] as HTMLElement).className).not.toContain("masked");
    });

    it("leaves the theme's background when the browser will not give a 2D canvas", () => {
        const host = document.createElement("div");
        renderer.create.mockImplementationOnce(() => {
            throw new TypeError("Cannot read properties of null (reading 'createImageData')");
        });
        expect(twebWallpaperProvider.mount(host, "classic-106")).toBeUndefined();
        expect(host.children).toHaveLength(0);
    });

    it("draws nothing for a preset it does not have", () => {
        const host = document.createElement("div");
        expect(twebWallpaperProvider.mount(host, "classic-999")).toBeUndefined();
        expect(host.children).toHaveLength(0);
    });
});
