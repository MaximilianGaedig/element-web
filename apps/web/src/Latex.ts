/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { logger } from "matrix-js-sdk/src/logger";
import type * as KatexSdk from "katex";

import SettingsStore from "./settings/SettingsStore";

/**
 * KaTeX, loaded on demand.
 *
 * KaTeX and its stylesheet are about a megabyte between them, and only the `feature_latex_maths` labs flag
 * renders any of it. Loading them with the app made every session parse that megabyte, and the stylesheet
 * was render-blocking, so they are fetched when the flag is on instead: at startup, and when it is switched
 * on. Rendering a message stays synchronous, and a session without the flag never sees either file.
 */
let katex: typeof KatexSdk.default | undefined;
let loading: Promise<void> | undefined;

function load(): Promise<void> {
    loading ??= (async (): Promise<void> => {
        const [module] = await Promise.all([import("katex"), import("katex/dist/katex.css")]);
        katex = module.default;
    })().catch((e) => {
        loading = undefined;
        logger.error("Unable to load KaTeX", e);
    });
    return loading;
}

/**
 * Loads KaTeX if maths rendering is enabled, and when it is enabled later. The promise resolves once
 * maths can be rendered, which lets a caller that needs the rendered form wait for it.
 */
export function loadLatexIfEnabled(): Promise<void> {
    const loaded = SettingsStore.getValue("feature_latex_maths") ? load() : Promise.resolve();
    SettingsStore.watchSetting("feature_latex_maths", null, (_name, _roomId, _level, _levelValue, enabled) => {
        if (enabled) void load();
    });
    return loaded;
}

/**
 * Renders TeX to HTML, or returns undefined if KaTeX has not loaded yet, in which case the caller keeps
 * the plain-text fallback that the message carries alongside the maths.
 */
export function renderLatex(tex: string, displayMode: boolean): string | undefined {
    if (!katex) {
        void load(); // the flag was read before its watcher fired, or the maths came from a module
        return undefined;
    }
    return katex.renderToString(tex, { throwOnError: false, displayMode, output: "htmlAndMathml" });
}
