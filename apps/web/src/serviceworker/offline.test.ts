/*
Copyright 2026 Maximilian Gaedig

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

/*
 * The app asks for `config.<domain>.json` before it reads `config.json`, on every load. Most deployments
 * have no such file, and "there is none" was never kept: each start waited for the server to say 404
 * again - the only request of a warm start that left the machine - before using the config it already had.
 */
describe("the domain's own config", () => {
    const scope = "https://chat.example.org/";
    const held = new Map<string, Response>();
    const key = (k: string | Request): string => new URL(typeof k === "string" ? k : k.url, scope).href;
    const cache = {
        match: async (k: string | Request) => held.get(key(k))?.clone(),
        put: async (k: string | Request, r: Response) => void held.set(key(k), r),
    };
    const NETWORK = "waited for the network";

    /** What the page gets while the server has not answered yet. */
    async function answerWithoutNetwork(path: string): Promise<number | string> {
        const refreshes: Promise<unknown>[] = [];
        const request = new Request(`${scope}${path}?cachebuster=${Date.now()}`);
        const response = respondApp({ request, waitUntil: (p) => void refreshes.push(p) }, "revalidate");
        return Promise.race([
            response.then((res) => res.status),
            new Promise<string>((resolve) => setTimeout(() => resolve(NETWORK), 20)),
        ]);
    }

    /** Let one load go through with the server answering. */
    async function load(path: string): Promise<number> {
        const refreshes: Promise<unknown>[] = [];
        const request = new Request(`${scope}${path}?cachebuster=${Date.now()}`);
        const res = await respondApp({ request, waitUntil: (p) => void refreshes.push(p) }, "revalidate");
        await Promise.all(refreshes);
        return res.status;
    }

    function serve(status: number, body = "{}"): void {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(body, { status })),
        );
    }

    function serverNeverAnswers(): void {
        vi.stubGlobal(
            "fetch",
            vi.fn(() => new Promise<Response>(() => {})),
        );
    }

    beforeEach(() => {
        vi.stubEnv("NODE_ENV", "production");
        vi.stubGlobal("self", { registration: { scope } });
        vi.stubGlobal("caches", { open: async () => cache });
        held.clear();
        held.set(key("__index__"), new Response("<html></html>")); // a build is cached
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    it("remembers that there is none, so the next start does not wait to be told again", async () => {
        serve(404, "not found");
        expect(await load("config.chat.example.org.json")).toBe(404);

        serverNeverAnswers();
        expect(await answerWithoutNetwork("config.chat.example.org.json")).toBe(404);
    });

    it("picks the file up on the load after it appears", async () => {
        serve(404, "not found");
        await load("config.chat.example.org.json");

        serve(200, `{"brand":"Ours"}`);
        // This load still answers from what it knew, and learns better in the background...
        expect(await load("config.chat.example.org.json")).toBe(404);
        // ...so the next one has it.
        serverNeverAnswers();
        expect(await answerWithoutNetwork("config.chat.example.org.json")).toBe(200);
    });

    it("keeps the domain config it holds when the server answers 404 for it", async () => {
        serve(200, `{"brand":"Ours"}`);
        await load("config.chat.example.org.json");

        serve(404, "not found");
        await load("config.chat.example.org.json");

        serverNeverAnswers();
        expect(await answerWithoutNetwork("config.chat.example.org.json")).toBe(200);
    });

    it("does not remember a missing config.json: that one is an error, not an answer", async () => {
        serve(404, "not found");
        expect(await load("config.json")).toBe(404);

        serverNeverAnswers();
        expect(await answerWithoutNetwork("config.json")).toBe(NETWORK);
    });

    it("does not remember a server error as an absent config", async () => {
        serve(503, "unavailable");
        expect(await load("config.chat.example.org.json")).toBe(503);

        serverNeverAnswers();
        expect(await answerWithoutNetwork("config.chat.example.org.json")).toBe(NETWORK);
    });

    it("does not remember a missing translation: only the config is asked for knowing it may not exist", async () => {
        serve(404, "not found");
        expect(await load("i18n/xx.json")).toBe(404);

        serverNeverAnswers();
        expect(await answerWithoutNetwork("i18n/xx.json")).toBe(NETWORK);
    });
});
