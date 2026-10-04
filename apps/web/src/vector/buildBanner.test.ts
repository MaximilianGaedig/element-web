// @vitest-environment happy-dom

/*
Copyright 2026 Maximilian Gaedig

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { screen } from "test-utils-rtl";

import { showBuildBanner } from "./buildBanner";

// The code under test reads document.cookie, so the tests set it the same way.
/* oxlint-disable unicorn/no-document-cookie */
function setCookie(value: string): void {
    document.cookie = `mxg_build=${value}; path=/`;
}

describe("showBuildBanner", () => {
    beforeEach(() => {
        document.body.innerHTML = `<div id="matrixchat"></div>`;
    });

    afterEach(() => {
        document.cookie = "mxg_build=; path=/; max-age=0";
        document.documentElement.classList.remove("mx_hasBuildBanner");
    });

    it("shows nothing without the cookie", () => {
        showBuildBanner();

        expect(document.getElementById("mx_BuildBanner")).toBeNull();
        expect(document.documentElement).not.toHaveClass("mx_hasBuildBanner");
    });

    it("shows nothing for the production build", () => {
        setCookie("prod");

        showBuildBanner();

        expect(document.getElementById("mx_BuildBanner")).toBeNull();
    });

    it("names the selected build above the app, with a link back to production", async () => {
        setCookie("pr-5");

        showBuildBanner();

        expect(await screen.findByText("Build pr-5, not production")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Return to production" })).toHaveAttribute("href", "/?build=prod");
        expect(document.getElementById("mx_BuildBanner")?.nextElementSibling?.id).toBe("matrixchat");
        expect(document.documentElement).toHaveClass("mx_hasBuildBanner");
    });
});
