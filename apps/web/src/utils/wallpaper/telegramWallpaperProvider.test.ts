/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { telegramWallpaperProvider, resetTelegramWallpapers, type BridgedWallpaper } from "./telegramWallpaperProvider";
import { onWallpapersChanged } from "./WallpaperProvider";

const bridge = vi.hoisted(() => ({ request: vi.fn(), create: vi.fn() }));

vi.mock("tweb/src/components/chat/gradientRenderer", () => ({
    default: {
        create: (colors: string) => {
            bridge.create(colors);
            return {
                gradientRenderer: { toNextPosition: () => {}, cleanup: () => {} },
                canvas: document.createElement("canvas"),
            };
        },
    },
}));
vi.mock("../../MatrixClientPeg", () => ({ MatrixClientPeg: { get: () => ({}) } }));
vi.mock("../../customisations/Media", () => ({
    mediaFromMxc: (mxc: string) => ({ srcHttp: `https://hs.example/media/${mxc.slice("mxc://".length)}` }),
}));
// The login does not name its bridge's API, as on the deployment; the server's list of bridges does.
vi.mock("../bridgeLogins", () => ({
    bridgeLoginsIn: () => [{ network: "WhatsApp" }, { network: "Telegram" }],
}));
vi.mock("../bridge/knownBridges", () => ({
    knownBridges: () => [
        { network: "WhatsApp", provisioningUrl: "https://wa.example/_matrix/provision" },
        { network: "Telegram", provisioningUrl: "https://tg.example/_matrix/provision" },
    ],
}));
vi.mock("../bridge/provisioning", () => ({ requestBridge: bridge.request }));

const cats: BridgedWallpaper = {
    id: "5944837766217924609",
    slug: "cats",
    kind: "pattern",
    settings: { background_color: 0xdbddbb, second_background_color: 0x6ba587, intensity: 50 },
    url: "mxc://telegram-media.internal/cats",
    thumbnail_url: "mxc://telegram-media.internal/cats-thumb",
};
const space: BridgedWallpaper = {
    id: "2",
    slug: "space",
    kind: "pattern",
    dark: true,
    settings: { background_color: 0xfec496, second_background_color: 0xdd6cb9, intensity: -50 },
    url: "mxc://telegram-media.internal/space",
};
const photo: BridgedWallpaper = {
    id: "3",
    kind: "image",
    settings: { intensity: 40 },
    url: "mxc://telegram-media.internal/photo",
};

async function loaded(list: BridgedWallpaper[]): Promise<void> {
    bridge.request.mockResolvedValue({ wallpapers: list });
    const changed = new Promise<void>((resolve) => {
        const stop = onWallpapersChanged(() => {
            stop();
            resolve();
        });
    });
    telegramWallpaperProvider.load!();
    await changed;
}

describe("telegramWallpaperProvider", () => {
    beforeEach(() => {
        localStorage.clear();
        resetTelegramWallpapers();
        vi.clearAllMocks();
    });
    afterEach(() => resetTelegramWallpapers());

    it("asks the Telegram bridge for the account's wallpapers and keeps them for the next start", async () => {
        expect(telegramWallpaperProvider.presets()).toEqual([]);
        await loaded([cats, space, photo]);

        expect(bridge.request).toHaveBeenCalledWith({}, "https://tg.example/_matrix/provision", "v3/wallpapers");
        // A picture suits either theme; a pattern is made for one.
        expect(telegramWallpaperProvider.presets()).toEqual([
            { id: cats.id, dark: false },
            { id: "2", dark: true },
            { id: "3", dark: undefined },
        ]);
        resetTelegramWallpapers();
        expect(telegramWallpaperProvider.presets()).toHaveLength(3);
    });

    it("draws the chosen pattern, and only its small preview in a picker", async () => {
        await loaded([cats]);

        const host = document.createElement("div");
        telegramWallpaperProvider.mount(host, cats.id);
        expect(bridge.create).toHaveBeenCalledWith("#dbddbb,#6ba587");
        const pattern = host.querySelector<HTMLElement>(".mx_ChatWallpaper_pattern")!;
        expect(pattern.style.backgroundImage).toContain("https://hs.example/media/telegram-media.internal/cats");
        expect(pattern.style.backgroundImage).not.toContain("thumb");

        const swatch = document.createElement("div");
        telegramWallpaperProvider.mount(swatch, cats.id, { swatch: true });
        expect(swatch.querySelector<HTMLElement>(".mx_ChatWallpaper_pattern")!.style.backgroundImage).toContain(
            "cats-thumb",
        );
    });

    it("shows a dark wallpaper's gradient through its pattern, and dims a picture", async () => {
        await loaded([space, photo]);

        const dark = document.createElement("div");
        telegramWallpaperProvider.mount(dark, "2");
        expect(dark.dataset.dark).toBe("true");
        expect(dark.querySelector<HTMLElement>("canvas")!.style.maskImage).toContain("space");

        const picture = document.createElement("div");
        telegramWallpaperProvider.mount(picture, "3");
        const image = picture.querySelector<HTMLElement>(".mx_ChatWallpaper_image")!;
        expect(image.style.backgroundImage).toContain("photo");
        expect(image.style.opacity).toBe("0.6");
    });
});
