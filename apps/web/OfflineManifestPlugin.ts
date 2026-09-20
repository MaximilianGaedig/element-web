/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import webpack, { type Compiler } from "webpack";

/** Where the service worker finds the list; keep in sync with src/serviceworker/offline.ts. */
export const OFFLINE_MANIFEST = "offline-manifest.json";

/**
 * Emitted files the service worker downloads so every part of the app works without a network: the code,
 * styles, WASM, workers, fonts, images, embedded Element Call and Jitsi, and the helper pages. Left out are
 * source maps and every translation but English (the user's own language is cached on first use).
 */
function isOfflineAsset(name: string): boolean {
    if (/\.(map|LICENSE\.txt)$/.test(name) || name.startsWith("..")) return false;
    if (/^(index\.html|sw\.js|version|config.*\.json|offline-manifest\.json)$/.test(name)) return false;
    if (/^(\.well-known|decoder-ring)\/|^apple-app-site-association$/.test(name)) return false;
    if (name.startsWith("i18n/")) return /^i18n\/(languages\.json|en_EN\.[^/]+\.json)$/.test(name);
    return true;
}

export class OfflineManifestPlugin {
    private readonly version: string;

    public constructor(version: string) {
        this.version = version;
    }

    public apply(compiler: Compiler): void {
        compiler.hooks.thisCompilation.tap("OfflineManifestPlugin", (compilation) => {
            compilation.hooks.processAssets.tap(
                { name: "OfflineManifestPlugin", stage: webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT },
                (assets) => {
                    const files = Object.keys(assets).filter(isOfflineAsset).sort();
                    const bytes = files.reduce((sum, f) => sum + assets[f].size(), 0);
                    const manifest = {
                        version: this.version,
                        // Every index.html of this build references bundles/<hash>/, so the worker can tell
                        // whether a fetched index.html belongs to this manifest.
                        hash: compilation.hash,
                        files,
                    };
                    compilation.emitAsset(OFFLINE_MANIFEST, new webpack.sources.RawSource(JSON.stringify(manifest)));
                    compilation
                        .getLogger("OfflineManifestPlugin")
                        .info(`${files.length} files, ${(bytes / 1e6).toFixed(1)} MB available offline`);
                },
            );
        });
    }
}
