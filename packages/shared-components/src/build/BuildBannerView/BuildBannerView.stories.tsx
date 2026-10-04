/*
 * Copyright 2026 Maximilian Gaedig
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { type Meta, type StoryObj } from "@storybook/react-vite";
import React, { type JSX } from "react";

import { useMockedViewModel } from "../../core/viewmodel";
import { withViewDocs } from "../../../.storybook/withViewDocs";
import { BuildBannerView, type BuildBannerViewSnapshot } from "./BuildBannerView";

const BuildBannerViewWrapperImpl = (props: BuildBannerViewSnapshot): JSX.Element => {
    const vm = useMockedViewModel(props, {});
    return <BuildBannerView vm={vm} />;
};
const BuildBannerViewWrapper = withViewDocs(BuildBannerViewWrapperImpl, BuildBannerView);

const meta = {
    title: "Build/BuildBannerView",
    component: BuildBannerViewWrapper,
    tags: ["autodocs"],
    args: {
        build: "pr-5",
        productionHref: "/?build=prod",
    },
} satisfies Meta<typeof BuildBannerViewWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const DevServer: Story = {
    args: { build: "dev-91" },
};
