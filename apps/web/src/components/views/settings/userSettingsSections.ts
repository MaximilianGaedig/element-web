/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The sections of the user's settings: which there are, in what order, under what name and icon.
 *
 * One list, read by both halves of the settings - the column beside the chats that lists them and the page
 * that shows the one chosen - so the two can never disagree about what exists. It is kept apart from what
 * each section renders because the list is in the startup graph (it is one of the column's views) and the
 * sections' contents are not: they are loaded when settings are first opened (UserSettingsPage).
 */

import { type ComponentType, type SVGAttributes } from "react";
import UserProfileIcon from "@vector-im/compound-design-tokens/assets/web/icons/user-profile";
import DevicesIcon from "@vector-im/compound-design-tokens/assets/web/icons/devices";
import VisibilityOnIcon from "@vector-im/compound-design-tokens/assets/web/icons/visibility-on";
import NotificationsIcon from "@vector-im/compound-design-tokens/assets/web/icons/notifications";
import PreferencesIcon from "@vector-im/compound-design-tokens/assets/web/icons/preferences";
import KeyboardIcon from "@vector-im/compound-design-tokens/assets/web/icons/keyboard";
import KeyIcon from "@vector-im/compound-design-tokens/assets/web/icons/key";
import SidebarIcon from "@vector-im/compound-design-tokens/assets/web/icons/sidebar";
import MicOnIcon from "@vector-im/compound-design-tokens/assets/web/icons/mic-on";
import LockIcon from "@vector-im/compound-design-tokens/assets/web/icons/lock";
import LabsIcon from "@vector-im/compound-design-tokens/assets/web/icons/labs";
import BlockIcon from "@vector-im/compound-design-tokens/assets/web/icons/block";
import HelpIcon from "@vector-im/compound-design-tokens/assets/web/icons/help";
import BridgeIcon from "@vector-im/compound-design-tokens/assets/web/icons/link";
import ActivityIcon from "@vector-im/compound-design-tokens/assets/web/icons/calendar";
import StorageIcon from "@vector-im/compound-design-tokens/assets/web/icons/chart";

import { _td } from "../../../languageHandler";
import { UserTab } from "../dialogs/UserTab";
import { type ScreenName } from "../../../PosthogTrackers";
import SettingsStore from "../../../settings/SettingsStore";
import SdkConfig from "../../../SdkConfig";
import { UIFeature } from "../../../settings/UIFeature";
import { useSettingValue } from "../../../hooks/useSettings";
import { type NonEmptyArray } from "../../../@types/common";

export interface UserSettingsSection {
    id: UserTab;
    label: TranslationKey;
    Icon: ComponentType<SVGAttributes<SVGElement>>;
    /** What the section is reported as to analytics, as the settings dialog reported its tabs. */
    screenName?: ScreenName;
    /** Pointless without a keyboard: left out of the list on a phone, which has none. */
    needsKeyboard?: boolean;
}

/** Whether the labs flags themselves are offered, rather than only the betas. */
export const showLabsFlags = (): boolean => {
    return SdkConfig.get("show_labs_settings") || SettingsStore.getValue("developerMode");
};

const ACCOUNT: UserSettingsSection = {
    id: UserTab.Account,
    label: _td("settings|account|title"),
    Icon: UserProfileIcon,
    screenName: "UserSettingsGeneral",
};

/**
 * The sections there are now, in order. Voice, Labs and the ignored users only exist in some setups, and
 * two of those can be switched on while settings are open, so this follows them.
 */
export function useUserSettingsSections(): NonEmptyArray<UserSettingsSection> {
    const voipEnabled = useSettingValue(UIFeature.Voip);
    const mjolnirEnabled = useSettingValue("feature_mjolnir");
    const labsEnabled =
        showLabsFlags() || SettingsStore.getFeatureSettingNames().some((k) => SettingsStore.getBetaInfo(k));

    const sections: NonEmptyArray<UserSettingsSection> = [
        ACCOUNT,
        { id: UserTab.SessionManager, label: _td("settings|sessions|title"), Icon: DevicesIcon },
        {
            id: UserTab.Appearance,
            label: _td("common|appearance"),
            Icon: VisibilityOnIcon,
            screenName: "UserSettingsAppearance",
        },
        {
            id: UserTab.Notifications,
            label: _td("notifications|enable_prompt_toast_title"),
            Icon: NotificationsIcon,
            screenName: "UserSettingsNotifications",
        },
        {
            id: UserTab.Preferences,
            label: _td("common|preferences"),
            Icon: PreferencesIcon,
            screenName: "UserSettingsPreferences",
        },
        {
            id: UserTab.Keyboard,
            label: _td("settings|keyboard|title"),
            Icon: KeyboardIcon,
            screenName: "UserSettingsKeyboard",
            needsKeyboard: true,
        },
        {
            id: UserTab.Sidebar,
            label: _td("settings|sidebar|title"),
            Icon: SidebarIcon,
            screenName: "UserSettingsSidebar",
        },
    ];
    if (voipEnabled) {
        sections.push({
            id: UserTab.Voice,
            label: _td("settings|voip|title"),
            Icon: MicOnIcon,
            screenName: "UserSettingsVoiceVideo",
        });
    }
    sections.push(
        {
            id: UserTab.Security,
            label: _td("room_settings|security|title"),
            Icon: LockIcon,
            screenName: "UserSettingsSecurityPrivacy",
        },
        {
            id: UserTab.Encryption,
            label: _td("settings|encryption|title"),
            Icon: KeyIcon,
            screenName: "UserSettingsEncryption",
        },
    );
    if (labsEnabled) {
        sections.push({ id: UserTab.Labs, label: _td("common|labs"), Icon: LabsIcon, screenName: "UserSettingsLabs" });
    }
    if (mjolnirEnabled) {
        sections.push({
            id: UserTab.Mjolnir,
            label: _td("labs_mjolnir|title"),
            Icon: BlockIcon,
            screenName: "UserSettingMjolnir",
        });
    }
    sections.push(
        { id: UserTab.Bridges, label: _td("tg_layout|bridges_tab"), Icon: BridgeIcon },
        { id: UserTab.Activity, label: _td("tg_layout|activity_tab"), Icon: ActivityIcon },
        { id: UserTab.Storage, label: _td("settings|storage|title"), Icon: StorageIcon },
        {
            id: UserTab.Help,
            label: _td("setting|help_about|title"),
            Icon: HelpIcon,
            screenName: "UserSettingsHelpAbout",
        },
    );
    return sections;
}

/**
 * The section to show: the one asked for if it exists here, else the first. A link to a section this setup
 * does not have (the ignored users, with that lab off) lands on the account rather than on nothing.
 */
export function resolveUserSettingsSection(
    sections: NonEmptyArray<UserSettingsSection>,
    asked: UserTab | undefined,
): UserSettingsSection {
    return sections.find((section) => section.id === asked) ?? sections[0];
}
