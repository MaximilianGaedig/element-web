/*
Copyright 2026 Maximilian Gaedig

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";

import { BuildBannerViewModel } from "./BuildBannerViewModel";

describe("BuildBannerViewModel", () => {
    it("names the build and links back to production", () => {
        const vm = new BuildBannerViewModel({ build: "pr-5", pathname: "/" });
        expect(vm.getSnapshot()).toEqual({ build: "pr-5", productionHref: "/?build=prod" });
        vm.dispose();
    });
});
