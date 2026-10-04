/*
 * Copyright 2026 Maximilian Gaedig
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX } from "react";
import { Link, Text } from "@vector-im/compound-web";

import styles from "./BuildBannerView.module.css";
import { type ViewModel, useViewModel } from "../../core/viewmodel";
import { useI18n } from "../../core/i18n/i18nContext";

/**
 * Snapshot for the BuildBannerView.
 */
export interface BuildBannerViewSnapshot {
    /**
     * The id of the selected build, e.g. `pr-5` or `dev-91`.
     */
    build: string;
    /**
     * Where the link back to the production build points.
     */
    productionHref: string;
}

/**
 * The view model for BuildBannerView.
 */
export type BuildBannerViewModel = ViewModel<BuildBannerViewSnapshot>;

interface BuildBannerViewProps {
    /**
     * The view model for the banner.
     */
    vm: BuildBannerViewModel;
}

/**
 * A thin bar that says the page is running a build other than production, with a link back to production.
 *
 * @example
 * ```tsx
 * <BuildBannerView vm={buildBannerViewModel} />
 * ```
 */
export function BuildBannerView({ vm }: Readonly<BuildBannerViewProps>): JSX.Element {
    const { translate: _t } = useI18n();
    const { build, productionHref } = useViewModel(vm);

    return (
        <div className={styles.banner} role="status">
            <Text as="span" size="sm" weight="medium">
                {_t("build_banner|not_production", { build })}
            </Text>
            <Link href={productionHref} size="sm">
                {_t("build_banner|return_to_production")}
            </Link>
        </div>
    );
}
