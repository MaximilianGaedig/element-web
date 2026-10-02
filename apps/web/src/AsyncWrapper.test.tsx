/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "test-utils-rtl";
import { mockPlatformPeg } from "test-utils";

import AsyncWrapper, { isLoadFailure } from "./AsyncWrapper";

function Failing({ error }: { error: Error }): never {
    throw error;
}

const chunkError = (): Error => Object.assign(new Error("Loading chunk 123 failed."), { name: "ChunkLoadError" });

describe("AsyncWrapper", () => {
    const reload = vi.fn();

    beforeEach(() => {
        reload.mockClear();
        mockPlatformPeg({ reload });
        vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("tells a dialog's code not arriving from the dialog failing", () => {
        expect(isLoadFailure(chunkError())).toBe(true);
        expect(isLoadFailure(new TypeError("Failed to fetch dynamically imported module: https://x/y.js"))).toBe(true);
        expect(isLoadFailure(new TypeError("Importing a module script failed."))).toBe(true);
        expect(isLoadFailure(new TypeError("Cannot read properties of undefined (reading 'name')"))).toBe(false);
    });

    it("shows what is inside when nothing goes wrong", () => {
        render(
            <AsyncWrapper onFinished={vi.fn()}>
                <div>the dialog</div>
            </AsyncWrapper>,
        );

        expect(screen.getByText("the dialog")).toBeInTheDocument();
    });

    it("blames the connection only when the dialog's code did not arrive, and offers a reload", () => {
        const onFinished = vi.fn();
        render(
            <AsyncWrapper onFinished={onFinished}>
                <Failing error={chunkError()} />
            </AsyncWrapper>,
        );

        expect(screen.getByText("Unable to load! Check your network connectivity and try again.")).toBeInTheDocument();
        screen.getByRole("button", { name: "Reload" }).click();
        expect(reload).toHaveBeenCalledTimes(1);
        screen.getByRole("button", { name: "Dismiss" }).click();
        expect(onFinished).toHaveBeenCalledTimes(1);
    });

    it("says a dialog that broke is broken, with what it broke on, and offers a reload", () => {
        render(
            <AsyncWrapper onFinished={vi.fn()}>
                <Failing error={new TypeError("Cannot read properties of undefined (reading 'name')")} />
            </AsyncWrapper>,
        );

        expect(screen.queryByText(/network connectivity/)).toBeNull();
        expect(screen.getByText("Something went wrong!")).toBeInTheDocument();
        expect(screen.getByText("Cannot read properties of undefined (reading 'name')")).toBeInTheDocument();
        screen.getByRole("button", { name: "Reload" }).click();
        expect(reload).toHaveBeenCalledTimes(1);
    });
});
