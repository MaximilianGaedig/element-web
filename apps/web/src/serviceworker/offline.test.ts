/*
Copyright 2026 Maximilian Gaedig

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { afterEach, describe, expect, it, vi } from "vitest";

import { respondApp, syncAppCache } from "./offline";

describe("development app caching", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    it("loads the current app even when a production shell is already cached", async () => {
        vi.stubEnv("NODE_ENV", "development");
        const open = vi.fn().mockResolvedValue({ match: vi.fn().mockResolvedValue(new Response("old app")) });
        vi.stubGlobal("caches", { open });
        const fresh = new Response("current dev app");
        const fetch = vi.fn().mockResolvedValue(fresh);
        vi.stubGlobal("fetch", fetch);
        const request = new Request("http://localhost:8080/?updated=1.12.28-dev");

        expect(await respondApp({ request, waitUntil: vi.fn() }, "shell")).toBe(fresh);
        expect(fetch).toHaveBeenCalledWith(request);
        expect(open).not.toHaveBeenCalled();
    });

    it("does not load a leftover production manifest from the dev server", async () => {
        vi.stubEnv("NODE_ENV", "development");
        const fetch = vi.fn();
        vi.stubGlobal("fetch", fetch);

        await syncAppCache();

        expect(fetch).not.toHaveBeenCalled();
    });
});

describe("build files", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    it("answers a build file it can neither find nor fetch with a network error, not a rejection", async () => {
        vi.stubEnv("NODE_ENV", "production");
        vi.stubGlobal("caches", { open: vi.fn().mockResolvedValue({ match: vi.fn().mockResolvedValue(undefined) }) });
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
        const request = new Request("https://chat.example.org/bundles/abc/gone.js");

        const res = await respondApp({ request, waitUntil: vi.fn() }, "build");

        expect(res.type).toBe("error");
    });
});
