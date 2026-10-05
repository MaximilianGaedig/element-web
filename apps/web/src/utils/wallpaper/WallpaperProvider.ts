/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/** One wallpaper a provider offers. */
export interface WallpaperPreset {
    /** Unique within its provider; what the setting stores, after the provider's id. */
    id: string;
    /** Whether it is made for a dark theme. */
    dark: boolean;
}

/** A wallpaper drawn into the page. */
export interface MountedWallpaper {
    /** Plays the wallpaper's answer to the user sending a message, if it has one (Telegram turns its gradient). */
    onMessageSent?(): void;
    /** Removes everything the wallpaper added to the page. */
    destroy(): void;
}

/**
 * A source of chat wallpapers: Telegram's (through tweb) or any other. A provider draws its wallpapers itself, so
 * one that animates or loads images brings its own renderer and Element Web only gives it a place to draw.
 */
export interface WallpaperProvider {
    /** Unique; the first part of a stored wallpaper reference. */
    id: string;
    /** The wallpapers it offers, in the order a picker shows them. */
    presets(): WallpaperPreset[];
    /**
     * Draws a wallpaper into `host`, which it fills; undefined for a preset it does not know.
     * @param options.swatch - drawn small, for a picker: what tells the wallpaper apart rather than its detail.
     */
    mount(host: HTMLElement, presetId: string, options?: { swatch?: boolean }): MountedWallpaper | undefined;
}
