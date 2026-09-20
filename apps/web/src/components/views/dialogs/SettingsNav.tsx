/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The handheld chrome of the settings, laid out like Telegram iOS's Settings: the list of sections opens
 * with your profile, and a section's page has a bar with a back button ("‹ Settings") and its title. Both
 * are hidden on a desktop, where the settings keep their side-by-side layout (see _TgSheets.pcss).
 */

import React, { type JSX } from "react";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { _t } from "../../../languageHandler";
import BaseAvatar from "../avatars/BaseAvatar";
import { OwnProfileStore } from "../../../stores/OwnProfileStore";

export function SettingsNavBar({
    page,
    title,
    onBack,
    onClose,
}: {
    page: "list" | "page";
    title: React.ReactNode;
    onBack: () => void;
    onClose: () => void;
}): JSX.Element {
    return (
        <div className="mx_SettingsNavBar" data-page={page}>
            {page === "page" ? (
                <button type="button" className="mx_SettingsNavBar_back" onClick={onBack}>
                    <span aria-hidden className="mx_SettingsNavBar_chevron">
                        ‹
                    </span>
                    {_t("common|settings")}
                </button>
            ) : (
                <span className="mx_SettingsNavBar_spacer" />
            )}
            <span className="mx_SettingsNavBar_title">{page === "page" ? title : _t("common|settings")}</span>
            {page === "list" ? (
                <button type="button" className="mx_SettingsNavBar_done" onClick={onClose}>
                    {_t("action|done")}
                </button>
            ) : (
                <span className="mx_SettingsNavBar_spacer" />
            )}
        </div>
    );
}

export function SettingsNavProfile({ client }: { client?: MatrixClient }): JSX.Element | null {
    if (!client) return null;
    const userId = client.getSafeUserId();
    const name = OwnProfileStore.instance.displayName || userId;
    return (
        <div className="mx_SettingsNavProfile">
            <BaseAvatar
                name={name}
                idName={userId}
                url={OwnProfileStore.instance.getHttpAvatarUrl(180)}
                size="90px"
                type="round"
            />
            <div className="mx_SettingsNavProfile_name">{name}</div>
            <div className="mx_SettingsNavProfile_id">{userId}</div>
        </div>
    );
}
