/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { createContext, type JSX, useContext } from "react";
import { IconButton } from "@vector-im/compound-web";
import ArrowLeftIcon from "@vector-im/compound-design-tokens/assets/web/icons/arrow-left";

import { _t } from "../../../languageHandler";

/** What the Telegram-style columns tell the views inside them. */
export interface TgNavigation {
    /** Single-pane handheld layout (tweb ScreenSize.mobile, ≤600px). */
    handheld: boolean;
    /** Slide the open chat away and show the chat list (tweb's handheld back / onPop). */
    goBack?: () => void;
}

export const TgNavigationContext = createContext<TgNavigation>({ handheld: false });

export function useTgNavigation(): TgNavigation {
    return useContext(TgNavigationContext);
}

/**
 * The chat topbar's back button on handhelds (tweb src/components/chat/topbar.ts .sidebar-close-button,
 * shown when the layout is single-pane). Renders nothing elsewhere.
 */
export function TgBackButton(): JSX.Element | null {
    const { handheld, goBack } = useTgNavigation();
    if (!handheld || !goBack) return null;
    return (
        <IconButton className="mx_TgBackButton" onClick={goBack} aria-label={_t("action|back")} size="40px">
            <ArrowLeftIcon />
        </IconButton>
    );
}
