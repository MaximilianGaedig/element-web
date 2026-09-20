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
}: {
    title: React.ReactNode;
    onBack: () => void;
    onClose: () => void;
}): JSX.Element {
    return (
        <div className="mx_SettingsNavBar">
            <button type="button" className="mx_SettingsNavBar_back" onClick={onBack} aria-label={_t("action|back")}>
                <ChevronLeftIcon />
            </button>
            <span className="mx_SettingsNavBar_title">{title}</span>
            <button type="button" className="mx_SettingsNavBar_done" onClick={onClose} aria-label={_t("action|close")}>
                <CloseIcon />
            </button>
        </div>
    );
}
