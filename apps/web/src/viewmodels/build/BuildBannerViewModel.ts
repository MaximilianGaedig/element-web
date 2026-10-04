/*
Copyright 2026 Maximilian Gaedig

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { BaseViewModel, type BuildBannerViewSnapshot } from "@element-hq/web-shared-components";

export interface BuildBannerViewModelProps {
    /**
     * The id of the selected build, e.g. `pr-5`.
     */
    build: string;
    /**
     * The page path, so the link back to production opens the app root again.
     */
    pathname: string;
}

/**
 * Backs the bar that says the page is running a build other than production.
 */
export class BuildBannerViewModel extends BaseViewModel<BuildBannerViewSnapshot, BuildBannerViewModelProps> {
    public constructor(props: BuildBannerViewModelProps) {
        super(props, { build: props.build, productionHref: `${props.pathname}?build=prod` });
    }
}
