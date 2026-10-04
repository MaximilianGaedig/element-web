/*
 * Copyright 2026 Maximilian Gaedig
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React from "react";
import { composeStories } from "@storybook/react-vite";
import { describe, expect, it } from "vitest";
import { render, screen } from "@test-utils";

import * as stories from "./BuildBannerView.stories";

const { Default, DevServer } = composeStories(stories);

describe("BuildBannerView", () => {
    it("names the build and says it is not production", () => {
        render(<Default />);
        expect(screen.getByText("Build pr-5, not production")).toBeInTheDocument();
    });

    it("links back to production", () => {
        render(<DevServer />);
        expect(screen.getByText("Build dev-91, not production")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Return to production" })).toHaveAttribute("href", "/?build=prod");
    });
});
