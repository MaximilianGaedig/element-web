/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Which section of the settings is open, for the list of them in the column beside it.
 *
 * MatrixChat decides it - opening a section is navigation, with a URL of its own (#/settings/<section>) -
 * and writes it here, because the list is inside the left panel, which MatrixChat's page state does not
 * reach. Undefined is the list with nothing chosen yet: on a phone the list is the whole screen until a
 * section is picked; beside a page there is always one shown, the first.
 */

import { useSyncExternalStore } from "react";

import { UserTab } from "../components/views/dialogs/UserTab";

const STORAGE_KEY = "mx_tg_settings_section";

function readRemembered(): UserTab | undefined {
    try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        return Object.values(UserTab).find((tab) => tab === stored);
    } catch {
        return undefined; // no storage (a private window): the settings just open as they would for a first visit
    }
}

let section: UserTab | undefined;
/*
 * Where the settings were left, for when they are come back to: the section (kept across a reload as well,
 * as the one thing worth that), how far it was scrolled and what was typed into the search. Undefined is
 * the list of them on a phone, so that stays what you return to as well.
 */
let remembered: UserTab | undefined = readRemembered();
const scrolls = new Map<UserTab, number>();
let searchText = "";
const listeners = new Set<() => void>();

export const userSettingsSection = (): UserTab | undefined => section;

export function setUserSettingsSection(next: UserTab | undefined): void {
    if (next === section) return;
    section = next;
    remembered = next;
    try {
        if (next) window.localStorage.setItem(STORAGE_KEY, next);
        else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
        // Kept for the session in `remembered` regardless.
    }
    // A copy: a listener may unsubscribe while being told (see roomListPanelView.ts).
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export const useUserSettingsSection = (): UserTab | undefined =>
    useSyncExternalStore(subscribe, userSettingsSection, userSettingsSection);

/** The section the settings were last left on, to go back to when they are opened without one asked for. */
export const rememberedUserSettingsSection = (): UserTab | undefined => remembered;

export const sectionScroll = (id: UserTab): number => scrolls.get(id) ?? 0;
export const rememberSectionScroll = (id: UserTab, top: number): void => void scrolls.set(id, top);

export const settingsSearchText = (): string => searchText;
export const rememberSettingsSearchText = (text: string): void => {
    searchText = text;
};
