/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";

import { indexedSettings, searchSettings, sectionContentLabels } from "./settingsSearch";
import SettingsStore from "../../../settings/SettingsStore";
import { UserTab } from "../dialogs/UserTab";
import { type UserSettingsSection } from "./userSettingsSections";

const section = (id: UserTab, label: string): UserSettingsSection => ({
    id,
    label: label as TranslationKey,
    Icon: () => null,
});
const sections = [
    section(UserTab.Account, "settings|account|title"),
    section(UserTab.Appearance, "common|appearance"),
    section(UserTab.Preferences, "common|preferences"),
    section(UserTab.Security, "room_settings|security|title"),
];

describe("searchSettings", () => {
    it("finds a setting by its label, in the section that has it", () => {
        const [first] = searchSettings("12 hour", sections);
        expect(first).toMatchObject({ section: UserTab.Preferences, sectionLabel: "Preferences" });
        expect(first.label?.toLowerCase()).toContain("12");
    });

    it("finds a section by its name, as the section itself", () => {
        expect(searchSettings("appear", sections)[0]).toEqual({
            section: UserTab.Appearance,
            sectionLabel: "Appearance",
        });
    });

    it("finds a heading a section labels itself", () => {
        const found = searchSettings("deactivate", sections);
        expect(found[0]).toMatchObject({ section: UserTab.Account, label: "Deactivate Account" });
    });

    it("ignores case, accents and the order of the words", () => {
        expect(searchSettings("TIMESTAMPS ALWAYS", sections)[0]).toMatchObject({ section: UserTab.Preferences });
        expect(searchSettings("déactivate", sections)[0]).toMatchObject({ section: UserTab.Account });
    });

    it("only looks in the sections this setup has", () => {
        const found = searchSettings("timestamps", [section(UserTab.Account, "settings|account|title")]);
        expect(found).toEqual([]);
    });

    it("finds nothing for nothing, or for what is not there", () => {
        expect(searchSettings("   ", sections)).toEqual([]);
        expect(searchSettings("zzzzqq", sections)).toEqual([]);
    });

    it("puts a section named by the query before settings that merely mention it", () => {
        const found = searchSettings("security", sections);
        expect(found[0]).toEqual({ section: UserTab.Security, sectionLabel: "Security & Privacy" });
    });
});

describe("the index", () => {
    /* A misspelt key would otherwise just never be found. */
    it.each(indexedSettings().flatMap(([tab, names]) => names.map((name) => [tab, name] as const)))(
        "has a label for %s's %s",
        (_tab, name) => {
            expect(SettingsStore.getDisplayName(name)).toBeTruthy();
        },
    );

    it("labels what a section draws", () => {
        expect(sectionContentLabels(UserTab.Appearance)).toContain("Font size");
        expect(sectionContentLabels(UserTab.Help)).toEqual([]);
    });
});
