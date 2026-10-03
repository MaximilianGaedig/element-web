/*
Copyright 2024 New Vector Ltd.
Copyright 2019-2024 The Matrix.org Foundation C.I.C.
Copyright 2019 New Vector Ltd

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Fork: one section of the user's settings, as the page beside the chat list - where a chat is shown -
 * rather than as a dialog over everything. The list of sections is the column's settings view
 * (UserSettingsList); this is what was the dialog's right-hand side, with its own header in place of the
 * dialog's title and close button: there is nothing to close, only somewhere else to go.
 *
 * Loaded when settings are first opened (LoggedInView), as it pulls in every section's contents and the
 * page around them is in the startup graph.
 */

import { Toast } from "@vector-im/compound-web";
import React, { type JSX } from "react";
import { ToastContext, useActiveToast } from "@element-hq/web-shared-components";

import ErrorBoundary from "../elements/ErrorBoundary";
import { _t } from "../../../languageHandler";
import AccountUserSettingsTab from "./tabs/user/AccountUserSettingsTab";
import LabsUserSettingsTab from "./tabs/user/LabsUserSettingsTab";
import AppearanceUserSettingsTab from "./tabs/user/AppearanceUserSettingsTab";
import SecurityUserSettingsTab from "./tabs/user/SecurityUserSettingsTab";
import NotificationUserSettingsTab from "./tabs/user/NotificationUserSettingsTab";
import PreferencesUserSettingsTab from "./tabs/user/PreferencesUserSettingsTab";
import VoiceUserSettingsTab from "./tabs/user/VoiceUserSettingsTab";
import BridgesUserSettingsTab from "./tabs/user/BridgesUserSettingsTab";
import StorageUserSettingsTab from "./tabs/user/StorageUserSettingsTab";
import ActivityUserSettingsTab from "./tabs/user/ActivityUserSettingsTab";
import HelpUserSettingsTab from "./tabs/user/HelpUserSettingsTab";
import MjolnirUserSettingsTab from "./tabs/user/MjolnirUserSettingsTab";
import SidebarUserSettingsTab from "./tabs/user/SidebarUserSettingsTab";
import KeyboardUserSettingsTab from "./tabs/user/KeyboardUserSettingsTab";
import SessionManagerTab from "./tabs/user/SessionManagerTab";
import { EncryptionUserSettingsTab, type State } from "./tabs/user/EncryptionUserSettingsTab";
import { UserTab } from "../dialogs/UserTab";
import { PosthogScreenTracker } from "../../../PosthogTrackers";
import { resolveUserSettingsSection, useUserSettingsSections } from "./userSettingsSections";
import { setRoomListPanelView } from "../../../utils/roomListPanelView";
import { TgBackButton, useTgNavigation } from "../telegram/TgNavigation";

export interface UserSettingsPageProps {
    /** The section asked for; the first one there is when it is not given, or not there in this setup. */
    section?: UserTab;
    /*
     * What a section is opened to, for the one link that asked for it. They are part of the navigation
     * that opened the section, so going to another section and back - a new navigation - drops them, and
     * the QR code or the status field does not come back unasked.
     */
    showMsc4108QrCode?: boolean;
    /** The Account section's status control starts in custom status mode, ready to type into. */
    startCustomStatus?: boolean;
    /** The initial state of the Encryption section; "loading" when not given. */
    initialEncryptionState?: State;
}

/** Out of settings altogether, back to the chats: what "close the settings" means once they are a place. */
function leaveSettings(): void {
    setRoomListPanelView("rooms");
}

function SectionBody({ id, props }: { id: UserTab; props: UserSettingsPageProps }): JSX.Element | null {
    switch (id) {
        case UserTab.Account:
            return (
                <AccountUserSettingsTab closeSettingsFn={leaveSettings} startCustomStatus={props.startCustomStatus} />
            );
        case UserTab.SessionManager:
            return <SessionManagerTab showMsc4108QrCode={props.showMsc4108QrCode} />;
        case UserTab.Appearance:
            return <AppearanceUserSettingsTab />;
        case UserTab.Notifications:
            return <NotificationUserSettingsTab />;
        case UserTab.Preferences:
            return <PreferencesUserSettingsTab />;
        case UserTab.Keyboard:
            return <KeyboardUserSettingsTab />;
        case UserTab.Sidebar:
            return <SidebarUserSettingsTab />;
        case UserTab.Voice:
            return <VoiceUserSettingsTab />;
        case UserTab.Security:
            return <SecurityUserSettingsTab />;
        case UserTab.Encryption:
            return <EncryptionUserSettingsTab initialState={props.initialEncryptionState} />;
        case UserTab.Labs:
            return <LabsUserSettingsTab />;
        case UserTab.Mjolnir:
            return <MjolnirUserSettingsTab />;
        case UserTab.Bridges:
            return <BridgesUserSettingsTab />;
        case UserTab.Activity:
            return <ActivityUserSettingsTab />;
        case UserTab.Storage:
            return <StorageUserSettingsTab />;
        case UserTab.Help:
            return <HelpUserSettingsTab />;
    }
}

export default function UserSettingsPage(props: UserSettingsPageProps): JSX.Element | null {
    const { handheld } = useTgNavigation();
    const section = resolveUserSettingsSection(useUserSettingsSections(), props.section);
    const [activeToast, toastRack] = useActiveToast();

    // On a phone, until a section is chosen, the list is the whole screen and there is no page to show.
    if (handheld && !props.section) return null;

    return (
        <ToastContext.Provider value={toastRack}>
            <section className="mx_UserSettingsPage" aria-labelledby="mx_UserSettingsPage_title">
                {section.screenName && <PosthogScreenTracker screenName={section.screenName} />}
                <header className="mx_UserSettingsPage_header">
                    {/* On a phone, back to the list of sections, as a chat's header goes back to the chats. */}
                    <TgBackButton />
                    <h1 id="mx_UserSettingsPage_title" className="mx_UserSettingsPage_title">
                        {_t(section.label)}
                    </h1>
                </header>
                <div className="mx_UserSettingsPage_body" data-section={section.id}>
                    {/*
                     * A section that fails is replaced by the error, in its place: the list and the other
                     * sections stay reachable. Keyed, as the sections share this place on screen and a failed
                     * one would otherwise stay failed when another is opened.
                     */}
                    <ErrorBoundary key={section.id}>
                        <SectionBody id={section.id} props={props} />
                    </ErrorBoundary>
                </div>
                <div className="mx_UserSettingsPage_toastContainer">{activeToast && <Toast>{activeToast}</Toast>}</div>
            </section>
        </ToastContext.Provider>
    );
}
