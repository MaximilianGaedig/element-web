/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The settings, as the column beside the chats shows them: the list of sections, with the chosen one open
 * in the page beside it - Telegram's settings, and the list the settings dialog used to keep down its own
 * left edge. On a phone the list is the whole screen and a section slides over it, as a chat does.
 *
 * Choosing a section is navigation (Action.ViewUserSettings, #/settings/<section>) rather than state of
 * this list's own, so a link to one, the back button and the browser's history all agree with it.
 */

import React, { type JSX } from "react";
import { IconButton } from "@vector-im/compound-web";
import BackIcon from "@vector-im/compound-design-tokens/assets/web/icons/chevron-left";
import { ClientEvent, type MatrixEvent } from "matrix-js-sdk/src/matrix";

import { _t } from "../../../languageHandler";
import defaultDispatcher from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { type OpenToTabPayload } from "../../../dispatcher/payloads/OpenToTabPayload";
import { UserTab } from "../dialogs/UserTab";
import { resolveUserSettingsSection, useUserSettingsSections } from "./userSettingsSections";
import { useUserSettingsSection } from "../../../utils/userSettingsSection";
import { setRoomListPanelView } from "../../../utils/roomListPanelView";
import { useTgNavigation } from "../telegram/TgNavigation";
import { useMatrixClientContext } from "../../../contexts/MatrixClientContext";
import { NoChange, useEventEmitterAsyncState, type AsyncStateCallbackResult } from "../../../hooks/useEventEmitter";

function openSection(id: UserTab): void {
    defaultDispatcher.dispatch<OpenToTabPayload>({ action: Action.ViewUserSettings, initialTabId: id });
}

/**
 * Whether the account has no recovery set up, which the Encryption section is marked for until it does: the
 * one setting worth drawing the eye to from the list, as the dialog's tab did.
 */
function useRecoveryMissing(): boolean {
    const client = useMatrixClientContext();
    return useEventEmitterAsyncState(
        client,
        ClientEvent.AccountData,
        async (event?: MatrixEvent): AsyncStateCallbackResult<boolean> => {
            if (event === undefined || event.getType() === "m.secret_storage.default_key") {
                return !(await client.secretStorage.getDefaultKeyId());
            }
            return new NoChange();
        },
        [client],
        false,
    );
}

export function UserSettingsList(): JSX.Element {
    const { handheld } = useTgNavigation();
    const all = useUserSettingsSections();
    const sections = handheld ? all.filter((section) => !section.needsKeyboard) : all;
    const asked = useUserSettingsSection();
    /*
     * Beside the page the first section is showing when none was asked for, so it is the one marked; on a
     * phone nothing is showing yet, and nothing is marked on a list you have yet to choose from.
     */
    const current = handheld ? asked : resolveUserSettingsSection(all, asked).id;
    const recoveryMissing = useRecoveryMissing();

    return (
        <div className="mx_UserSettingsList">
            <div className="mx_UserSettingsList_header">
                <IconButton aria-label={_t("action|back")} onClick={() => setRoomListPanelView("rooms")} size="32px">
                    <BackIcon />
                </IconButton>
                <h2 className="mx_UserSettingsList_title">{_t("common|settings")}</h2>
            </div>
            <ul className="mx_UserSettingsList_sections" aria-label={_t("common|settings")}>
                {sections.map(({ id, label, Icon }) => (
                    <li key={id}>
                        <button
                            type="button"
                            className="mx_UserSettingsList_section"
                            aria-current={id === current ? "page" : undefined}
                            data-alert={(id === UserTab.Encryption && recoveryMissing) || undefined}
                            onClick={() => openSection(id)}
                        >
                            <Icon width="24" height="24" aria-hidden />
                            <span>{_t(label)}</span>
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
}
