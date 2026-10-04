/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Finding a setting by what it says, rather than by guessing which section it is in.
 *
 * The sections are Element's own and draw their controls themselves, so there is no data of the settings
 * to search; this is the one place that says which section each is in. A setting is named by its
 * SettingsStore key, so its label is the one the section shows (the display name in Settings.tsx), and
 * what is not a setting of that kind - a heading, a control with a label of its own - is named by the
 * translation key the section draws it with. The label is also how the page finds the control to scroll
 * to (UserSettingsPage), so nothing here knows about markup.
 *
 * Read by the list of sections and by Spotlight, so the two cannot disagree about what there is.
 */

import { _t } from "../../../languageHandler";
import SettingsStore from "../../../settings/SettingsStore";
import { type SettingKey } from "../../../settings/Settings";
import { UserTab } from "../dialogs/UserTab";
import { type UserSettingsSection } from "./userSettingsSections";

interface SectionContents {
    /** Settings the section draws with their display name as the label. */
    settings?: SettingKey[];
    /** Headings and controls the section labels itself. */
    labels?: TranslationKey[];
}

/*
 * Add a setting here when a section gets one: a test checks each has a label, so a misspelt key fails
 * rather than silently never being found.
 */
const CONTENTS: Partial<Record<UserTab, SectionContents>> = {
    [UserTab.Account]: {
        labels: [
            "settings|general|display_name",
            "settings|general|emails_heading",
            "settings|general|msisdns_heading",
            "settings|general|password_change_section",
            "settings|general|account_management_section",
            "settings|general|deactivate_section",
        ],
    },
    [UserTab.Appearance]: {
        settings: [
            "floatingBars",
            "chatColumns",
            "bubbleTimeline",
            "compactMedia",
            "handheldSheets",
            "chatProfilePanel",
            "mobileMessagePadding",
            "glassEffects",
            "bubbleTail",
            "useBundledEmojiFont",
            "useSystemFont",
            "systemFont",
        ],
        labels: ["settings|appearance|font_size"],
    },
    [UserTab.Preferences]: {
        settings: [
            "RoomList.showMessagePreview",
            "RoomList.showSections",
            "RoomList.showPeopleSection",
            "RoomList.showSpacePath",
            "RoomList.showSpacePathIcons",
            "Spaces.allRoomsInHome",
            "ctrlFForSearch",
            "showTwelveHourTimestamps",
            "alwaysShowTimestamps",
            "userTimezonePublish",
            "sendReadReceipts",
            "sendTypingNotifications",
            "MessageComposerInput.autoReplaceEmoji",
            "MessageComposerInput.useMarkdown",
            "MessageComposerInput.suggestEmoji",
            "MessageComposerInput.ctrlEnterToSend",
            "MessageComposerInput.surroundWith",
            "MessageComposerInput.showStickersButton",
            "MessageComposerInput.insertTrailingColon",
            "enableSyntaxHighlightLanguageDetection",
            "expandCodeByDefault",
            "showCodeLineNumbers",
            "urlPreviewsEnabled",
            "urlPreviewsEnabled_e2ee",
            "urlPreviewsEnabled_e2ee_bundled_only",
            "autoplayGifs",
            "autoplayVideo",
            "groupConsecutiveImages",
            "showTypingNotifications",
            "showRedactions",
            "showReadReceipts",
            "showJoinLeaves",
            "showDisplaynameChanges",
            "showChatEffects",
            "showAvatarChanges",
            "Pill.shouldShowPillAvatar",
            "TextualBody.enableBigEmoji",
            "scrollToBottomOnMessageSent",
            "useOnlyCurrentProfiles",
            "RoomHeader.showSpacePath",
            "SpotlightSearch.showNsfwPublicRooms",
            "promptBeforeInviteUnknownUsers",
            "Electron.showTrayIcon",
            "Electron.enableHardwareAcceleration",
            "Electron.enableContentProtection",
            "Electron.alwaysShowMenuBar",
            "Electron.warnBeforeExit",
        ],
        labels: ["settings|general|language_section", "settings|general|allow_spellcheck"],
    },
    [UserTab.Voice]: {
        settings: ["VideoView.flipVideoHorizontally", "webRtcAllowPeerToPeer", "enableLegacyCallsVoip"],
        labels: ["settings|voip|voice_section", "settings|voip|video_section"],
    },
    [UserTab.Security]: {
        settings: ["pseudonymousAnalyticsOptIn", "deviceClientInformationOptIn"],
        labels: [
            "common|secure_backup",
            "settings|security|ignore_users_section",
            "settings|security|bulk_options_section",
            "settings|security|message_search_section",
        ],
    },
};

export interface SettingsSearchResult {
    /** The words the section draws it with; what the page scrolls to. Undefined for the section itself. */
    label?: string;
    section: UserTab;
    sectionLabel: string;
}

/** Every label of a section's contents, as the section draws them, without those a setup does not label. */
export function sectionContentLabels(section: UserTab): string[] {
    const contents = CONTENTS[section];
    if (!contents) return [];
    const names = (contents.settings ?? []).map((name) => SettingsStore.getDisplayName(name));
    const labels = (contents.labels ?? []).map((key) => _t(key));
    return [...names, ...labels].filter((label): label is string => !!label);
}

/** Which of the settings with a section this has, by key: for the test that guards the table. */
export const indexedSettings = (): [UserTab, SettingKey[]][] =>
    Object.entries(CONTENTS).map(([tab, contents]) => [tab as UserTab, contents.settings ?? []]);

const fold = (text: string): string => text.toLocaleLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

/** How well the label answers the query: lower is better, undefined is not at all. */
function rank(label: string, words: string[]): number | undefined {
    const folded = fold(label);
    if (!words.every((word) => folded.includes(word))) return undefined;
    if (folded.startsWith(words.join(" "))) return 0;
    return folded.split(/\s+/).some((part) => part.startsWith(words[0])) ? 1 : 2;
}

/**
 * The settings and sections that answer the query, best first: a section by its name, a setting by its
 * label, only in the sections given (the ones this setup has).
 */
export function searchSettings(
    query: string,
    sections: readonly UserSettingsSection[],
    limit = 30,
): SettingsSearchResult[] {
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];

    const found: { result: SettingsSearchResult; rank: number; order: number }[] = [];
    for (const { id, label } of sections) {
        const sectionLabel = _t(label);
        const own = rank(sectionLabel, words);
        if (own !== undefined) found.push({ result: { section: id, sectionLabel }, rank: own, order: found.length });
        for (const content of new Set(sectionContentLabels(id))) {
            // A section's name outranks a setting's equally good match: it is the broader answer.
            const ranked = rank(content, words);
            if (ranked !== undefined) {
                found.push({
                    result: { label: content, section: id, sectionLabel },
                    rank: ranked + 0.5,
                    order: found.length,
                });
            }
        }
    }
    return found
        .sort((a, b) => a.rank - b.rank || a.order - b.order)
        .slice(0, limit)
        .map(({ result }) => result);
}
