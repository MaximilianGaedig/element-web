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
 */

export const APP_CACHE = "element-app-v1";
export const MEDIA_CACHE = "element-media-v1";
const KNOWN_CACHES = new Set([APP_CACHE, MEDIA_CACHE]);

const OFFLINE_MANIFEST = "offline-manifest.json";
/** Where the worker keeps the manifest of the build whose index.html it serves. */
const MANIFEST_KEY = "__offline_manifest__";
const SHELL_KEY = "__index__";

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
 * of embedded Element Call, Jitsi and the download frame).
 */
export type AppRequestKind = "shell" | "revalidate" | "network-first" | "immutable" | "build";

/** How an app request (same origin as the worker) is answered, or undefined to leave it to the network. */
export function classifyAppRequest(request: Request, scope: string): AppRequestKind | undefined {
    if (request.method !== "GET") return undefined;
    const url = new URL(request.url);
    const base = new URL(scope);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return undefined;
    const path = url.pathname.slice(base.pathname.length);

    if (request.mode === "navigate" && (path === "" || path === "index.html")) return "shell";
    // A homeserver on the same origin: its API and media are not ours to cache here.
    if (path.startsWith("_matrix/") || path.startsWith(".well-known/")) return undefined;
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

/** Runtime entries (not build files): kept when a new build replaces the old one. */
function isRuntimeEntry(url: string, scope: string): boolean {
    const path = new URL(url).pathname.slice(new URL(scope).pathname.length);
    return (
        path === SHELL_KEY ||
        path === MANIFEST_KEY ||
        /^config(\.[^/]+)?\.json$/.test(path) ||
        path === "manifest.json" ||
        path === "version" ||
        path.startsWith("i18n/")
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

/** Answers an app request per {@link classifyAppRequest}; the network as before until a build is cached. */
export async function respondApp(event: FetchEventLike, kind: AppRequestKind): Promise<Response> {
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
                if (res.ok) await cache.put(stripSearch(event.request.url), res.clone());
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
    appSync ??= doSyncAppCache()
        .catch((e) => console.warn("[ServiceWorker] Offline cache update failed", e))
        .finally(() => (appSync = undefined));
    return appSync;
}

async function doSyncAppCache(): Promise<void> {
    const res = await fetch(scopeUrl(OFFLINE_MANIFEST), { cache: "no-store" });
    if (!res.ok) return; // dev build, or not deployed with a manifest
    const manifest: OfflineManifest = await res.json();
    const cache = await caches.open(APP_CACHE);
    const current: OfflineManifest | undefined = await (await cache.match(MANIFEST_KEY))?.json();
    if (current?.hash === manifest.hash && (await appCacheReady(cache))) return;

    console.log(`[ServiceWorker] Caching build ${manifest.version} (${manifest.files.length} files) for offline use`);
    await forEachLimit(manifest.files, 6, async (file) => {
        const url = scopeUrl(file);
        if (await cache.match(url)) return;
        const r = await fetch(url);
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
