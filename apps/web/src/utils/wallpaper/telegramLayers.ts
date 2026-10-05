/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * How a Telegram wallpaper is put together, as tweb does it (src/components/chat/bubbles/chatBackground.tsx): its
 * gradient renderer underneath, and over it a pattern or a picture. The gradient renderer is tweb's own, imported.
 */

import ChatBackgroundGradientRenderer from "tweb/src/components/chat/gradientRenderer";

import { type MountedWallpaper } from "./WallpaperProvider";

/**
 * How the pattern sits on the gradient. Light wallpapers lay it over the gradient in soft light; dark ones show the
 * gradient only through the pattern, on black; Night Tinted ("Dark") lays a lightened pattern over its dark gradient.
 */
export type PatternMode = "soft-light" | "mask" | "inverted";

export interface TelegramWallpaperLayers {
    /** The gradient's stops, `#rrggbb`, comma-separated, as tweb's renderer takes them; empty for none. */
    colors: string;
    /** 0..1: how strongly the pattern (or, masked, the gradient) shows, or how much a picture is dimmed. */
    intensity: number;
    /** A pattern drawn over the gradient. */
    pattern?: { url: string; mode: PatternMode };
    /** A picture over the gradient, instead of a pattern. */
    imageUrl?: string;
}

/**
 * Draws a Telegram wallpaper into `host`; undefined if the browser will not give a 2D canvas for its gradient.
 * @param swatch - drawn small, for a picker.
 */
export function mountTelegramWallpaper(
    host: HTMLElement,
    layers: TelegramWallpaperLayers,
    swatch = false,
): MountedWallpaper | undefined {
    let renderer: ChatBackgroundGradientRenderer | undefined;
    const added: HTMLElement[] = [];
    if (layers.colors) {
        let created: ReturnType<typeof ChatBackgroundGradientRenderer.create>;
        try {
            created = ChatBackgroundGradientRenderer.create(layers.colors);
        } catch {
            // The renderer draws on a 2D canvas, which a browser may refuse (fingerprinting protection, no
            // memory); the chat is then left on the theme's background rather than failing with it.
            return undefined;
        }
        renderer = created.gradientRenderer;
        created.canvas.className = "mx_ChatWallpaper_gradient";
        added.push(created.canvas);
    }
    const canvas = added[0];

    if (layers.imageUrl) {
        const image = document.createElement("div");
        image.className = "mx_ChatWallpaper_image";
        // Set here, not through a custom property: a url() in one would resolve against the stylesheet.
        image.style.backgroundImage = `url("${layers.imageUrl}")`;
        // tweb dims a picture by its intensity, never below 0.3.
        if (layers.intensity) image.style.opacity = String(Math.max(0.3, 1 - layers.intensity));
        added.push(image);
    } else if (layers.pattern) {
        const { url, mode } = layers.pattern;
        // A dark wallpaper is its colours seen through thin lines: at a swatch's size that is black. Show the colours.
        if (mode === "mask" && canvas && !swatch) {
            // tweb dims the gradient that shows through the pattern, never below 0.3.
            canvas.style.opacity = String(Math.max(0.3, layers.intensity * 0.5));
            canvas.style.maskImage = `url("${url}")`;
            canvas.classList.add("mx_ChatWallpaper_gradient_masked");
            host.dataset.dark = "true";
        } else {
            const pattern = document.createElement("div");
            pattern.className = `mx_ChatWallpaper_pattern mx_ChatWallpaper_pattern_${mode === "mask" ? "soft-light" : mode}`;
            pattern.style.backgroundImage = `url("${url}")`;
            pattern.style.opacity = String(layers.intensity);
            added.push(pattern);
        }
    }

    host.append(...added);
    return {
        onMessageSent: renderer && (() => renderer.toNextPosition()),
        destroy: () => {
            renderer?.cleanup();
            for (const element of added) element.remove();
            delete host.dataset.dark;
        },
    };
}
