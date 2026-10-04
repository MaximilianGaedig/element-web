/*
Copyright 2026 Maximilian Gaedig

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";

import { getSelectedBuild } from "./selectedBuild";

describe("getSelectedBuild", () => {
    it("is undefined without the cookie", () => {
        expect(getSelectedBuild("")).toBeUndefined();
        expect(getSelectedBuild("theme=dark; other=1")).toBeUndefined();
    });

    it("is undefined for the production build", () => {
        expect(getSelectedBuild("mxg_build=prod")).toBeUndefined();
    });

    it("reads a build id among other cookies", () => {
        expect(getSelectedBuild("theme=dark; mxg_build=dev-91; other=1")).toBe("dev-91");
        expect(getSelectedBuild("mxg_build=pr-5")).toBe("pr-5");
    });

    it("ignores values the server would not route", () => {
        expect(getSelectedBuild("mxg_build=PR_5")).toBeUndefined();
        expect(getSelectedBuild("mxg_build=<b>x</b>")).toBeUndefined();
        expect(getSelectedBuild(`mxg_build=${"a".repeat(41)}`)).toBeUndefined();
    });

    it("does not mistake a cookie that merely ends in the name", () => {
        expect(getSelectedBuild("not_mxg_build=pr-5")).toBeUndefined();
    });
});
