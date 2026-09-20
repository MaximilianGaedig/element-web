/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { BaseViewModel, type UserMenuSnapshot, type UserMenuViewActions } from "@element-hq/web-shared-components";
import { logger } from "matrix-js-sdk/src/logger";

import { type OwnProfileStore } from "../../stores/OwnProfileStore";
import { UPDATE_EVENT } from "../../stores/AsyncStore";
import type { MatrixDispatcher } from "../../dispatcher/dispatcher";
import Modal from "../../Modal";
import { Action } from "../../dispatcher/actions";
import { UserTab } from "../../components/views/dialogs/UserTab";
import FeedbackDialog from "../../components/views/dialogs/FeedbackDialog";
import { shouldShowFeedback } from "../../utils/Feedback";
import { getHomePageUrl } from "../../utils/pages";
import SdkConfig from "../../SdkConfig";
import type { MatrixClient } from "matrix-js-sdk/src/matrix";
import { clearAllUserStatus } from "../../utils/userStatus";
import { type SetStatusViewModel, UserMenuSetStatusViewModel } from "../status/SetStatusViewModel";
import SettingsStore from "../../settings/SettingsStore";
import { UIFeature } from "../../settings/UIFeature";
import { _t } from "../../languageHandler";
import {
    CalendarIcon,
    ChartIcon,
    ComputerIcon,
    HelpIcon,
    HistoryIcon,
    KeyIcon,
    LinkIcon,
    LabsIcon,
    LockIcon,
    MicOnIcon,
    NotificationsIcon,
    PreferencesIcon,
    SidebarIcon,
    UserProfileIcon,
    VisibilityOnIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";
import type React from "react";

/** The settings sections the menu lists on a handheld, in Element's usual order. */
const SECTIONS: Array<{
    id: UserTab;
    label: Parameters<typeof _t>[0];
    Icon: React.ComponentType<React.SVGAttributes<SVGElement>>;
    /** The section is only there when this holds (the same conditions as the settings dialog's tabs). */
    when?: () => boolean;
}> = [
    { id: UserTab.Account, label: "settings|account|title", Icon: UserProfileIcon },
    { id: UserTab.SessionManager, label: "settings|sessions|title", Icon: ComputerIcon },
    { id: UserTab.Appearance, label: "common|appearance", Icon: VisibilityOnIcon },
    { id: UserTab.Notifications, label: "notifications|enable_prompt_toast_title", Icon: NotificationsIcon },
    { id: UserTab.Preferences, label: "common|preferences", Icon: PreferencesIcon },
    { id: UserTab.Sidebar, label: "settings|sidebar|title", Icon: SidebarIcon },
    {
        id: UserTab.Voice,
        label: "settings|voip|title",
        Icon: MicOnIcon,
        when: () => !!SettingsStore.getValue(UIFeature.Voip),
    },
    { id: UserTab.Security, label: "room_settings|security|title", Icon: LockIcon },
    { id: UserTab.Encryption, label: "settings|encryption|title", Icon: KeyIcon },
    {
        id: UserTab.Labs,
        label: "common|labs",
        Icon: LabsIcon,
        when: () =>
            !!(SdkConfig.get("show_labs_settings") || SettingsStore.getValue("developerMode")) ||
            SettingsStore.getFeatureSettingNames().some((k) => !!SettingsStore.getBetaInfo(k)),
    },
    { id: UserTab.Bridges, label: "tg_layout|bridges_tab", Icon: LinkIcon },
    { id: UserTab.Import, label: "tg_layout|import_tab", Icon: HistoryIcon },
    { id: UserTab.Activity, label: "tg_layout|activity_tab", Icon: CalendarIcon },
    { id: UserTab.Storage, label: "settings|storage|title", Icon: ChartIcon },
    { id: UserTab.Help, label: "setting|help_about|title", Icon: HelpIcon },
];

// Matches maximum size of an avatar in the UserMenu
const AVATAR_PX = 88;

interface UserMenuViewModelProps {
    ownProfileStore: OwnProfileStore;
}

export class UserMenuViewModel
    extends BaseViewModel<UserMenuSnapshot, UserMenuViewModelProps>
    implements UserMenuViewActions
{
    public readonly setStatusVm: SetStatusViewModel;
    private static computeSnapshot(
        client: MatrixClient,
        ownProfileStore: OwnProfileStore,
        isPanelCollapsed: boolean,
    ): UserMenuSnapshot {
        const hasHomePage = !!getHomePageUrl(SdkConfig.get(), client);
        const isAuthenticated = !client.isGuest();
        const userId = client.getSafeUserId();
        const displayName = ownProfileStore.displayName || userId;
        const avatarUrl = ownProfileStore.getHttpAvatarUrl(AVATAR_PX) ?? undefined;

        const setStatusViewModel = new UserMenuSetStatusViewModel({
            client,
            ownProfileStore,
        });

        return {
            open: false,
            userId,
            displayName,
            avatarUrl,
            expanded: !isPanelCollapsed,
            showAvatar: isAuthenticated,
            userStatus: ownProfileStore.userStatus,
            showUserStatus: SettingsStore.getValue("feature_user_status") && isAuthenticated,
            setStatusViewModel,
            actions: {
                createAccount: !isAuthenticated,
                signIn: !isAuthenticated,
                openHomePage: hasHomePage,
                linkNewDevice: isAuthenticated,
                openSecurity: isAuthenticated,
                openFeedback: shouldShowFeedback(),
                openSettings: true,
            },
        };
    }

    public constructor(
        props: UserMenuViewModelProps,
        private readonly dispatcher: MatrixDispatcher,
        private readonly client: MatrixClient,
        isPanelCollapsed: boolean,
    ) {
        super(props, UserMenuViewModel.computeSnapshot(client, props.ownProfileStore, isPanelCollapsed));
        this.setStatusVm = new UserMenuSetStatusViewModel({ client, ownProfileStore: props.ownProfileStore });
        props.ownProfileStore.on(UPDATE_EVENT, this.recalculateProfile);
    }

    public dispose(): void {
        this.props.ownProfileStore.off(UPDATE_EVENT, this.recalculateProfile);
        this.setStatusVm.dispose();
        super.dispose();
    }

    public readonly recalculateProfile = (): void => {
        const displayName = this.props.ownProfileStore.displayName || this.snapshot.current.userId;
        const avatarUrl = this.props.ownProfileStore.getHttpAvatarUrl(AVATAR_PX) ?? undefined;
        const userStatus = this.props.ownProfileStore.userStatus;
        this.snapshot.merge({ displayName, avatarUrl, userStatus });
    };

    public readonly setOpen = (isOpen: boolean): void => {
        // On a phone the menu is the settings' front page: list the sections (fresh, as the screen size may
        // have changed since the menu was built).
        this.snapshot.merge({
            open: isOpen,
            ...(isOpen ? UserMenuViewModel.handheldParts(this.snapshot.current) : {}),
        });
    };

    /** Settings sections shown in the menu on a handheld, and the entries they replace. */
    private static handheldParts(current: UserMenuSnapshot): Partial<UserMenuSnapshot> {
        const handheld = document.documentElement.dataset.tgScreen === "mobile" && current.showAvatar;
        if (!handheld) return { sections: undefined };
        return {
            sections: SECTIONS.filter(({ when }) => !when || when()).map(({ id, label, Icon }) => ({
                id,
                label: _t(label),
                Icon,
            })),
            actions: { ...current.actions, openSecurity: false, openSettings: false },
        };
    }

    public readonly openSection = (id: string): void => {
        this.setOpen(false);
        this.dispatcher.dispatch({ action: Action.ViewUserSettings, initialTabId: id });
    };

    public readonly setExpanded = (expanded: boolean): void => {
        this.snapshot.merge({ expanded });
    };

    public readonly createAccount = (): void => {
        this.setOpen(false);
        this.dispatcher.dispatch({ action: "start_registration" });
    };

    public readonly signIn = (): void => {
        this.setOpen(false);
        this.dispatcher.dispatch({ action: "start_login" });
    };

    public readonly openHomePage = (): void => {
        this.setOpen(false);
        this.dispatcher.dispatch({ action: Action.ViewHomePage });
    };

    public readonly openFeedback = (): void => {
        this.setOpen(false);
        Modal.createDialog(FeedbackDialog);
    };

    public readonly linkNewDevice = (): void => {
        this.setOpen(false);
        this.dispatcher.dispatch({
            action: Action.ViewUserSettings,
            initialTabId: UserTab.SessionManager,
            props: { showMsc4108QrCode: true },
        });
    };

    public readonly openSecurity = (): void => {
        this.setOpen(false);
        this.dispatcher.dispatch({
            action: Action.ViewUserSettings,
            initialTabId: UserTab.Security,
        });
    };

    public readonly openSettings = (): void => {
        this.setOpen(false);
        this.dispatcher.dispatch({
            action: Action.ViewUserSettings,
        });
    };

    public readonly clearStatus = (): void => {
        this.setOpen(false);
        clearAllUserStatus(this.client).catch((err) => {
            logger.warn("Failed to clear user status", err);
        });
    };
}
