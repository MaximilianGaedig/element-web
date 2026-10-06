/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { logger } from "matrix-js-sdk/src/logger";
import { getColorsFromWallPaper } from "tweb/src/helpers/color";

import { MatrixClientPeg } from "../../MatrixClientPeg";
import { mediaFromMxc } from "../../customisations/Media";
import { bridgeLoginsIn } from "../bridgeLogins";
import { requestBridge } from "../bridge/provisioning";
import { networkKeyOf } from "../bridge/bridgeCommands";
import { knownBridges } from "../bridge/knownBridges";
import {
    notifyWallpapersChanged,
    type MountedWallpaper,
    type WallpaperPreset,
    type WallpaperProvider,
} from "./WallpaperProvider";
import { mountTelegramWallpaper } from "./telegramLayers";

/** One of the account's wallpapers, as the Telegram bridge lists them (`GET /v3/wallpapers`). */
export interface BridgedWallpaper {
    id: string;
    slug?: string;
    default?: boolean;
    dark?: boolean;
    /** A pattern over colours, a picture, or the colours alone. */
    kind: "pattern" | "image" | "fill";
    /** Telegram's wallPaperSettings; a colour that is absent is not the same as black. */
    settings?: {
        background_color?: number;
        second_background_color?: number;
        third_background_color?: number;
        fourth_background_color?: number;
        intensity?: number;
        rotation?: number;
        blur?: boolean;
        motion?: boolean;
    };
    /** The pattern (SVG) or picture, which the bridge fetches from Telegram only when it is asked for. */
    url?: string;
    thumbnail_url?: string;
}

const STORAGE_KEY = "mx_telegram_wallpapers";

let wallpapers: BridgedWallpaper[] | undefined;
let loading = false;

/** The last list the bridge gave, kept so the chat draws its wallpaper at start without asking again. */
function stored(): BridgedWallpaper[] {
    if (!wallpapers) {
        try {
            wallpapers = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as BridgedWallpaper[];
        } catch {
            wallpapers = [];
        }
    }
    return wallpapers;
}

/** Asks the Telegram bridge for the account's wallpapers, once a session. */
function load(): void {
    if (loading) return;
    const client = MatrixClientPeg.get();
    if (!client) return;
    const isTelegram = (network: string): boolean => networkKeyOf(network) === "telegram";
    const login = bridgeLoginsIn(client).find((l) => isTelegram(l.network));
    // The login names the bridge's API when it says; otherwise the server's list of bridges does.
    const provisioningUrl =
        login?.provisioningUrl ?? (login && knownBridges(client).find((b) => isTelegram(b.network))?.provisioningUrl);
    if (!provisioningUrl) return;
    loading = true;
    requestBridge<{ wallpapers: BridgedWallpaper[] }>(client, provisioningUrl, "v3/wallpapers")
        .then(({ wallpapers: fresh }) => {
            wallpapers = fresh;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
            notifyWallpapersChanged();
        })
        .catch((e) => {
            // Asked again on the next start; the stored list is used meanwhile.
            logger.warn("Could not get the Telegram wallpapers", e);
        });
}

/** The address a browser loads an mxc URI from. */
function httpUrl(mxc: string | undefined): string | undefined {
    return (mxc && mediaFromMxc(mxc).srcHttp) || undefined;
}

/**
 * The Telegram account's own wallpapers - Telegram's patterns, pictures and colours - through the Telegram bridge.
 * Only the pattern or picture of the wallpaper being drawn is downloaded (in a picker, its thumbnail), and the
 * bridge fetches it from Telegram only then.
 */
export const telegramWallpaperProvider: WallpaperProvider = {
    id: "telegram",
    presets(): WallpaperPreset[] {
        return stored().map((w) => ({ id: w.id, dark: w.kind === "image" ? undefined : !!w.dark }));
    },
    load,
    mount(host: HTMLElement, presetId: string, options?: { swatch?: boolean }): MountedWallpaper | undefined {
        const wallpaper = stored().find((w) => w.id === presetId);
        if (!wallpaper) return undefined;
        const settings = wallpaper.settings ?? {};
        const intensity = settings.intensity ?? 0;
        // In a picker the thumbnail stands in for the file: a fraction of the size, and all a swatch can show.
        const file = httpUrl((options?.swatch && wallpaper.thumbnail_url) || wallpaper.url);
        return mountTelegramWallpaper(
            host,
            {
                colors: getColorsFromWallPaper({ settings }),
                intensity: Math.abs(intensity) / 100,
                // tweb: a negative intensity is a dark wallpaper, whose gradient shows only through the pattern.
                pattern:
                    wallpaper.kind === "pattern" && file
                        ? { url: file, mode: intensity < 0 ? "mask" : "soft-light" }
                        : undefined,
                imageUrl: wallpaper.kind === "image" ? file : undefined,
            },
            options?.swatch,
        );
    },
};

/** @knipignore - exported for tests. Forgets the stored list and the session's request. */
export function resetTelegramWallpapers(): void {
    wallpapers = undefined;
    loading = false;
}
