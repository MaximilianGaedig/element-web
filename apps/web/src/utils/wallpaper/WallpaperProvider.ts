/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/** One wallpaper a provider offers. */
export interface WallpaperPreset {
    /** Unique within its provider; what the setting stores, after the provider's id. */
    id: string;
    /** Whether it is made for a dark theme; undefined for one that suits either (a picture). */
    dark?: boolean;
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
     * Fetches the presets of a provider that has to ask for them; it calls {@link notifyWallpapersChanged} when
     * they arrive, and caches them so the next start has them at once.
     */
    load?(): void;
    /**
     * Draws a wallpaper into `host`, which it fills; undefined for a preset it does not know.
     * @param options.swatch - drawn small, for a picker: what tells the wallpaper apart rather than its detail.
     */
    mount(host: HTMLElement, presetId: string, options?: { swatch?: boolean }): MountedWallpaper | undefined;
}

const listeners = new Set<() => void>();
let version = 0;

/** Tells whoever draws wallpapers that a provider's presets have changed (arrived, say). */
export function notifyWallpapersChanged(): void {
    version++;
    for (const listener of listeners) listener();
}

/** Calls `listener` whenever a provider's presets change; returns what stops it. */
export function onWallpapersChanged(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Moves on each time a provider's presets change, for useSyncExternalStore. */
export function wallpapersVersion(): number {
    return version;
}
