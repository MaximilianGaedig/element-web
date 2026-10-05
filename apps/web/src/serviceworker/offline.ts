/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Offline-first caching for the service worker.
 *
 * The app: a production build lists its files in offline-manifest.json (OfflineManifestPlugin). The worker
 * downloads all of them, then the matching index.html, and from then on answers the page, its code and its
 * config from the cache first, so the app opens instantly and with no network at all. A new deploy is picked
 * up in the background and used on the next load, once all of its files are in. Dev builds have no manifest,
 * so nothing of the app is cached there.
 *
 * Media: Matrix content is immutable per mxc URI, so downloads and thumbnails are kept and served from the
 * cache before any network or auth work.
 *
 * Build selector: opening `/?build=<id>` makes the server (nginx on chat.mxg.sh) answer with another build of
 * Element on this same origin, so the login and the caches carry over. While that build is selected the worker
 * steps aside completely: its page, config and files come from the network and nothing of them is cached
 * next to the production build. `?build=prod` brings the production build back.
 */

import { isOnDemandAsset } from "./onDemandAssets";

// v2: v1 kept every file it had ever cached under the same name (see isContentNamed), so it is
// thrown away rather than repaired - it cannot say which of its files are the stale ones.
export const APP_CACHE = "element-app-v2";
export const MEDIA_CACHE = "element-media-v1";
/** Holds one small entry: which build is selected, if any. */
export const PREVIEW_CACHE = "element-preview-v1";
const KNOWN_CACHES = new Set([APP_CACHE, MEDIA_CACHE, PREVIEW_CACHE]);

const OFFLINE_MANIFEST = "offline-manifest.json";
/** Where the worker keeps the manifest of the build whose index.html it serves. */
const MANIFEST_KEY = "__offline_manifest__";
const SHELL_KEY = "__index__";
const PREVIEW_KEY = "__preview__";

/** The ids the server routes: lower-case letters, digits and dashes. Anything else in `?build=` is ignored. */
const BUILD_ID = /^[a-z0-9-]{1,40}$/;
/** The server's `mxg_build` cookie lasts this long, so the selection ends with it. */
const PREVIEW_MS = 24 * 60 * 60 * 1000;

/*
 * A development build, read where it is used rather than decided once at import.
 *
 * Webpack still substitutes process.env.NODE_ENV at each call, so the production worker carries the
 * literal `false` and none of the dev branches below survive into it. What changes is that the value is
 * no longer fixed before a test can set it, which is why both dev-mode tests took the production path.
 */
// oxlint-disable-next-line node/no-process-env
const isDev = (): boolean => process.env.NODE_ENV === "development";

/** Media larger than this streams from the network each time rather than filling the cache. */
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
/** Oldest media entries go once there are more than this. */
const MAX_MEDIA_ENTRIES = 8000;
const TRIM_EVERY_PUTS = 100;

interface OfflineManifest {
    version: string;
    hash: string;
    files: string[];
    /** The previous build's files: kept, so a page still running it can load its lazy chunks. */
    previous?: string[];
}

/** The parts of a FetchEvent used here (the worker types clash with the DOM ones, see index.ts). */
export interface FetchEventLike {
    request: Request;
    waitUntil(promise: Promise<unknown>): void;
}

function scopeUrl(path: string): string {
    // @ts-expect-error - service worker types are not available
    return new URL(path, self.registration.scope).href;
}

/** Drop caches of older schemes; our own survive updates of the worker. */
export async function deleteUnknownCaches(): Promise<void> {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => !KNOWN_CACHES.has(n)).map((n) => caches.delete(n)));
}

/**
 * shell: the page; revalidate: small unhashed files (config, translations), cached and refreshed in the
 * background; network-first: `version` (update checks); immutable: content-hashed build files; build: any
 * other file of ours, answered from the cache when the build has it (workers, WASM, icons, and the pages
 * of embedded Element Call, Jitsi and the download frame); select-build: the page opened with `?build=<id>`,
 * which picks another build (or, for `prod`, leaves it) and is answered by the network.
 */
export type AppRequestKind = "shell" | "revalidate" | "network-first" | "immutable" | "build" | "select-build";

/** How an app request (same origin as the worker) is answered, or undefined to leave it to the network. */
export function classifyAppRequest(request: Request, scope: string): AppRequestKind | undefined {
    if (request.method !== "GET") return undefined;
    const url = new URL(request.url);
    const base = new URL(scope);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return undefined;
    const path = url.pathname.slice(base.pathname.length);

    if (request.mode === "navigate" && (path === "" || path === "index.html")) {
        return BUILD_ID.test(url.searchParams.get("build") ?? "") ? "select-build" : "shell";
    }
    // A homeserver on the same origin: its API and media are not ours to cache here.
    if (path.startsWith("_matrix/") || path.startsWith(".well-known/")) return undefined;
    // The remote inspection relay (utils/remoteDebug.ts): what it serves is made per request.
    if (path.startsWith("_rdbg/")) return undefined;
    // Webpack dev server: unhashed bundles and hot updates must always come from the network.
    if (path.includes("/_dev_/") || path.includes("hot-update") || path.startsWith("ws")) return undefined;
    if (path === "version") return "network-first";
    if (/^config(\.[^/]+)?\.json$/.test(path) || path === "manifest.json" || path.startsWith("i18n/")) {
        return "revalidate";
    }
    if (/^(bundles|fonts|img|themes|vector-icons|media)\//.test(path)) return "immutable";
    if (path === "sw.js" || path === OFFLINE_MANIFEST) return undefined;
    return "build";
}

/**
 * Whether a build file's name changes when its content does: a bundle under its build's hash, or a
 * file with a content hash in its name (`index-Bz16m3ir.js`).
 *
 * Only those can be kept from one build to the next without asking. The rest keep their name while
 * their content moves on - Element Call's `config.json`, its `index.html`, the icons and sounds - and
 * the cache used to hold on to the first copy it ever saw of each: a setting written into that
 * config.json reached the server and never the browser.
 */
export function isContentNamed(path: string): boolean {
    if (/^bundles\/[^/]+\//.test(path)) return true;
    const hash = /[.-]([A-Za-z0-9_-]{8,})\.[a-z0-9]+(\.map)?$/.exec(path)?.[1];
    // A hash has digits or mixed case in it; a word that happens to be eight letters long has neither.
    return !!hash && (/\d/.test(hash) || (/[a-z]/.test(hash) && /[A-Z]/.test(hash)));
}

/** Runtime entries (not build files, or build files taken in on use): kept when a new build replaces the old one. */
function isRuntimeEntry(url: string, scope: string): boolean {
    const path = new URL(url).pathname.slice(new URL(scope).pathname.length);
    return (
        path === SHELL_KEY ||
        path === MANIFEST_KEY ||
        /^config(\.[^/]+)?\.json$/.test(path) ||
        path === "manifest.json" ||
        path === "version" ||
        path.startsWith("i18n/") ||
        isOnDemandAsset(path)
    );
}

/**
 * The cached response for one of our URLs, or undefined.
 *
 * Cache Storage answers an exact URL from its index in well under a millisecond, but `ignoreSearch` makes it
 * enumerate every entry instead — about 15 ms with a build's worth of files in the cache, paid on every
 * request of every load, which added a quarter of a second to opening the app. Nothing needs the scan: build
 * files are stored under their own URL, and the files that are requested with a cachebuster (config,
 * translations, `version`) are stored under the URL without one, so two exact lookups cover both.
 */
async function matchApp(cache: Cache, url: string): Promise<Response | undefined> {
    const cached = await cache.match(url);
    if (cached) return cached;
    const stripped = stripSearch(url);
    return stripped === url ? undefined : cache.match(stripped);
}

/** Whether a production build's files have been cached, i.e. whether the app is served offline-first. */
async function appCacheReady(cache: Cache): Promise<boolean> {
    return !!(await cache.match(SHELL_KEY));
}

/** When the selected build lapses (ms since the epoch), or null for none; undefined until read from the cache. */
let previewUntil: number | null | undefined;

/**
 * Whether another build is selected. Kept in memory after the first read so the check costs nothing on
 * the requests that follow; the cache entry is what survives the worker being stopped.
 */
async function previewSelected(): Promise<boolean> {
    if (previewUntil === undefined) {
        const cache = await caches.open(PREVIEW_CACHE);
        const held: { until?: number } | undefined = await (await cache.match(PREVIEW_KEY))?.json();
        previewUntil = held?.until ?? null;
    }
    return previewUntil !== null && previewUntil > Date.now();
}

/** Records the selected build, or with `prod` that none is. */
async function selectBuild(id: string): Promise<void> {
    const cache = await caches.open(PREVIEW_CACHE);
    if (id === "prod") {
        previewUntil = null;
        await cache.delete(PREVIEW_KEY);
    } else {
        previewUntil = Date.now() + PREVIEW_MS;
        await cache.put(PREVIEW_KEY, Response.json({ id, until: previewUntil }));
    }
}

/** Answers an app request per {@link classifyAppRequest}; the network as before until a build is cached. */
export async function respondApp(event: FetchEventLike, kind: AppRequestKind): Promise<Response> {
    // A failed fetch (offline, or a file of a build that's gone) is a network error for the page either way.
    // Returned rather than thrown, it isn't also logged as an uncaught rejection in the worker.
    return respondAppOrThrow(event, kind).catch(() => Response.error());
}

async function respondAppOrThrow(event: FetchEventLike, kind: AppRequestKind): Promise<Response> {
    // This origin may still have a production app cached from before the dev server started.
    if (isDev()) return fetch(event.request);
    if (kind === "select-build") {
        const id = new URL(event.request.url).searchParams.get("build") ?? "";
        // A write that fails must not stop the page loading; the selection then simply lapses with the worker.
        await selectBuild(id).catch(() => {});
        const res = await fetch(event.request);
        // Only now has the server dropped its cookie, so a sync any earlier would cache the selected build as production.
        if (id === "prod") event.waitUntil(syncAppCache());
        return res;
    }
    // The selected build is served by the network whole, so none of its files mix with the cached production ones.
    if (await previewSelected().catch(() => false)) return fetch(event.request);
    const cache = await caches.open(APP_CACHE);
    if (!(await appCacheReady(cache))) {
        if (kind === "shell") event.waitUntil(syncAppCache());
        return fetch(event.request);
    }
    switch (kind) {
        case "shell": {
            // The cached page, instantly; a new deploy is fetched in the background for next time.
            event.waitUntil(syncAppCache());
            const cached = await cache.match(SHELL_KEY);
            return cached ?? fetch(event.request);
        }
        case "immutable": {
            const cached = await matchApp(cache, event.request.url);
            if (cached) return cached;
            const res = await fetch(event.request);
            if (res.ok) event.waitUntil(cache.put(event.request, res.clone()));
            return res;
        }
        case "revalidate": {
            const cached = await matchApp(cache, event.request.url);
            const refresh = fetch(event.request).then(async (res) => {
                // "There is no such config" is kept only where no config is held: a 404 never replaces one.
                if (res.ok || (isAbsentConfig(event.request.url, res) && !cached?.ok)) {
                    await cache.put(stripSearch(event.request.url), res.clone());
                }
                return res;
            });
            if (cached) {
                event.waitUntil(refresh.catch(() => {}));
                return cached;
            }
            return refresh;
        }
        case "build": {
            return (await matchApp(cache, event.request.url)) ?? fetch(event.request);
        }
        case "network-first": {
            try {
                const res = await fetch(event.request);
                if (res.ok) {
                    // The app's update check: a new version means a new build to make available offline.
                    const previous = await (await cache.match(stripSearch(event.request.url)))?.text();
                    const fresh = await res.clone().text();
                    event.waitUntil(cache.put(stripSearch(event.request.url), res.clone()));
                    if (previous !== undefined && previous !== fresh) event.waitUntil(syncAppCache());
                }
                return res;
            } catch (e) {
                const cached = await matchApp(cache, event.request.url);
                if (cached) return cached;
                throw e;
            }
        }
    }
}

/**
 * Whether this is the server saying the domain has no config of its own.
 *
 * The app asks for `config.<domain>.json` before it reads `config.json`, on every load, and most
 * deployments have no such file. That answer is kept like the config itself: otherwise each start waits
 * for the server to say 404 again - the one request of a warm start that leaves the machine - before
 * using the config it already holds. It is asked again in the background all the same, so a file that
 * appears is picked up on the following load.
 */
function isAbsentConfig(url: string, res: Response): boolean {
    return res.status === 404 && /\/config\.[^/]+\.json$/.test(new URL(url).pathname);
}

function stripSearch(url: string): string {
    const u = new URL(url);
    u.search = "";
    return u.href;
}

let appSync: Promise<void> | undefined;

/**
 * Brings the cache up to the deployed build: when offline-manifest.json names a new build, downloads its
 * files, then its index.html, and only then switches to them, so the cache always holds one whole build.
 * Runs when the app opens and when its update check sees a new version; failures (offline, mid-deploy)
 * leave the current build in place.
 */
export function syncAppCache(): Promise<void> {
    // The dev server can expose a leftover production manifest through its static directory.
    if (isDev()) return Promise.resolve();
    appSync ??= doSyncAppCache()
        .catch((e) => console.warn("[ServiceWorker] Offline cache update failed", e))
        .finally(() => (appSync = undefined));
    return appSync;
}

async function doSyncAppCache(): Promise<void> {
    // The manifest and index.html now come from the selected build: they must not replace production's cached ones.
    if (await previewSelected()) return;
    const res = await fetch(scopeUrl(OFFLINE_MANIFEST), { cache: "no-store" });
    if (!res.ok) return; // dev build, or not deployed with a manifest
    const manifest: OfflineManifest = await res.json();
    const cache = await caches.open(APP_CACHE);
    const current: OfflineManifest | undefined = await (await cache.match(MANIFEST_KEY))?.json();
    if (current?.hash === manifest.hash && (await appCacheReady(cache))) return;

    console.log(`[ServiceWorker] Caching build ${manifest.version} (${manifest.files.length} files) for offline use`);
    await forEachLimit(manifest.files, 6, async (file) => {
        const url = scopeUrl(file);
        // A file named after its content is the same file in every build that has it. Any other can
        // differ under the same name, so each new build's copy replaces the one held.
        const named = isContentNamed(file);
        if (named && (await cache.match(url))) return;
        const r = await fetch(url, named ? undefined : { cache: "no-store" });
        if (!r.ok) throw new Error(`${file}: ${r.status}`);
        await cache.put(url, r);
    });

    const index = await fetch(scopeUrl("./"), { cache: "no-store" });
    const html = await index.clone().text();
    if (!index.ok || !html.includes(manifest.hash)) {
        throw new Error("index.html is not from the cached build (deploy in progress?)");
    }

    // Keep this build and the previous one (a page still running it may lazy-load its chunks).
    const keep = new Set([...manifest.files, ...(current?.files ?? [])].map(scopeUrl));
    // @ts-expect-error - service worker types are not available
    const scope: string = self.registration.scope;
    for (const req of await cache.keys()) {
        if (!keep.has(req.url) && !isRuntimeEntry(req.url, scope)) await cache.delete(req);
    }

    await cache.put(SHELL_KEY, index);
    const stored: OfflineManifest = { ...manifest, previous: current?.files };
    await cache.put(MANIFEST_KEY, new Response(JSON.stringify(stored)));
    console.log(`[ServiceWorker] Build ${manifest.version} is available offline`);
}

async function forEachLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
    let next = 0;
    const worker = async (): Promise<void> => {
        while (next < items.length) await fn(items[next++]);
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** Whether the URL is a media download or thumbnail, legacy (v3) or authenticated (client v1). */
export function isMediaUrl(url: URL): boolean {
    return /^\/_matrix\/(media\/v3|client\/v1\/media)\/(download|thumbnail)\//.test(url.pathname);
}

/** The cache key for media: the same for the legacy and authenticated endpoints of one mxc URI. */
export function mediaCacheKey(url: URL): string {
    const key = new URL(url.href);
    key.pathname = key.pathname.replace(/^\/_matrix\/media\/v3\//, "/_matrix/client/v1/media/");
    return key.href;
}

export async function matchMedia(url: URL): Promise<Response | undefined> {
    const cache = await caches.open(MEDIA_CACHE);
    return cache.match(mediaCacheKey(url));
}

let mediaPuts = 0;

/** Keeps a complete, successful media response for next time. */
export async function storeMedia(url: URL, request: Request, res: Response): Promise<void> {
    if (res.status !== 200 || request.headers.has("range")) return;
    const length = Number(res.headers.get("content-length") ?? "0");
    if (length > MAX_MEDIA_BYTES) return;
    const cache = await caches.open(MEDIA_CACHE);
    await cache.put(mediaCacheKey(url), res);
    if (++mediaPuts % TRIM_EVERY_PUTS === 0) {
        const keys = await cache.keys(); // oldest first
        await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_MEDIA_ENTRIES)).map((k) => cache.delete(k)));
    }
}
