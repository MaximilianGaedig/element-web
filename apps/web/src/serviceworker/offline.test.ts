/*
Copyright 2026 Maximilian Gaedig

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { afterEach, describe, expect, it, vi } from "vitest";

import { isContentNamed, respondApp, syncAppCache } from "./offline";

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

describe("a new build", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    it("tells a file named after its content from one that keeps its name", () => {
        expect(isContentNamed("bundles/5f4cf380371795f36e31/init.js")).toBe(true);
        expect(isContentNamed("widgets/element-call/assets/index-Bz16m3ir.js")).toBe(true);
        expect(isContentNamed("widgets/element-call/assets/clap-AxCMZLTd.ogg")).toBe(true);
        expect(isContentNamed("widgets/element-call/config.json")).toBe(false);
        expect(isContentNamed("widgets/element-call/index.html")).toBe(false);
        expect(isContentNamed("vector-icons/favicon.ico")).toBe(false);
        // Eight letters is a word, not a hash.
        expect(isContentNamed("media/message-december.ogg")).toBe(false);
    });

    /*
     * Element Call's config.json was written to send cameras as H264. The server served it, and the
     * browser went on reading the copy it had cached before: a file already held under that name was
     * never fetched again, so the setting never arrived and the camera kept going out as VP8.
     */
    it("replaces the files that keep their name, and keeps the ones named after their content", async () => {
        vi.stubEnv("NODE_ENV", "production");
        const scope = "https://chat.example.org/";
        vi.stubGlobal("self", { registration: { scope } });
        const held = new Map<string, Response>();
        const key = (k: string | Request): string => new URL(typeof k === "string" ? k : k.url, scope).href;
        const cache = {
            match: async (k: string | Request) => held.get(key(k))?.clone(),
            put: async (k: string | Request, r: Response) => void held.set(key(k), r),
            delete: async (k: string | Request) => held.delete(key(k)),
            keys: async () => [...held.keys()].map((url) => new Request(url)),
        };
        vi.stubGlobal("caches", { open: async () => cache });
        const build = { hash: "one", config: "vp8" };
        const fetched: string[] = [];
        vi.stubGlobal(
            "fetch",
            vi.fn(async (input: string | Request) => {
                const path = key(input).slice(scope.length);
                fetched.push(path);
                if (path === "offline-manifest.json") {
                    return Response.json({
                        version: build.hash,
                        hash: build.hash,
                        files: ["widgets/element-call/config.json", "widgets/element-call/assets/index-Bz16m3ir.js"],
                    });
                }
                if (path === "") return new Response(`<html>${build.hash}</html>`);
                return new Response(path.endsWith("config.json") ? build.config : "chunk");
            }),
        );

        await syncAppCache();
        Object.assign(build, { hash: "two", config: "h264" });
        fetched.length = 0;
        await syncAppCache();

        expect(await (await cache.match("widgets/element-call/config.json"))?.text()).toBe("h264");
        expect(fetched).toContain("widgets/element-call/config.json");
        expect(fetched).not.toContain("widgets/element-call/assets/index-Bz16m3ir.js");
    });
});
