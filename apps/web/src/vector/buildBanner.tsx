/*
Copyright 2026 Maximilian Gaedig

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React from "react";
import { createRoot } from "react-dom/client";
import { BuildBannerView, I18nContext } from "@element-hq/web-shared-components";

import { ModuleApi } from "../modules/Api.ts";
import { getSelectedBuild } from "../utils/selectedBuild.ts";
import { BuildBannerViewModel } from "../viewmodels/build/BuildBannerViewModel.ts";

/**
 * Shows the bar above the app when another build than production is selected (`/?build=<id>`, docs/preview.md).
 * It has its own React root so it also shows on the error and login pages. Does nothing for the production build.
 */
export function showBuildBanner(): void {
    // Read synchronously: the server sets this cookie, and the bar must be there before the app renders.
    const build = getSelectedBuild(document.cookie);
    const app = document.getElementById("matrixchat");
    if (!build || !app) return;

    const container = document.createElement("div");
    container.id = "mx_BuildBanner";
    app.before(container);
    // The app root is as tall as the page; the class makes it share the page with the bar instead.
    document.documentElement.classList.add("mx_hasBuildBanner");

    const vm = new BuildBannerViewModel({ build, pathname: window.location.pathname });
    createRoot(container).render(
        <I18nContext.Provider value={ModuleApi.instance.i18n}>
            <BuildBannerView vm={vm} />
        </I18nContext.Provider>,
    );
}
