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

import { type UserTab } from "../components/views/dialogs/UserTab";

let section: UserTab | undefined;
const listeners = new Set<() => void>();

export const userSettingsSection = (): UserTab | undefined => section;

export function setUserSettingsSection(next: UserTab | undefined): void {
    if (next === section) return;
    section = next;
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
