/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The handheld bar of a settings page: a back button (to the user menu's drawer, which lists the sections),
 * the section's name and a close button. Hidden on a desktop, where the settings keep their side-by-side
 * layout (see _TgSheets.pcss).
 */

import React, { type JSX } from "react";
import ChevronLeftIcon from "@vector-im/compound-design-tokens/assets/web/icons/chevron-left";
import CloseIcon from "@vector-im/compound-design-tokens/assets/web/icons/close";

import { _t } from "../../../languageHandler";

export function SettingsNavBar({
    title,
    onBack,
    onClose,
    page = "page",
}: {
    title: React.ReactNode;
    onBack: () => void;
    onClose: () => void;
    /**
     * "list" is the first screen of a settings dialog that carries its own list of sections, where there
     * is nothing to go back to. The user settings have no such screen: their list is the user menu.
     */
    page?: "list" | "page";
}): JSX.Element {
    return (
        <div className="mx_SettingsNavBar" data-page={page}>
            {page === "page" ? (
                <button
                    type="button"
                    className="mx_SettingsNavBar_back"
                    onClick={onBack}
                    aria-label={_t("action|back")}
                >
                    <ChevronLeftIcon />
                </button>
            ) : (
                <span />
            )}
            <span className="mx_SettingsNavBar_title">{title}</span>
            <button type="button" className="mx_SettingsNavBar_done" onClick={onClose} aria-label={_t("action|close")}>
                <CloseIcon />
            </button>
        </div>
    );
}
