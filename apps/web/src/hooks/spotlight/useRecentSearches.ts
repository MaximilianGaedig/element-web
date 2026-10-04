/*
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { useState } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";

import { MatrixClientPeg } from "../../MatrixClientPeg";
import { SettingLevel } from "../../settings/SettingLevel";
import SettingsStore from "../../settings/SettingsStore";
import { filterBoolean } from "../../utils/arrays";

/** How many of each kind of recent search are kept. */
const MAX_RECENT_SEARCHES = 10;

/** The list with `entry` moved (or added) to its front, at most MAX_RECENT_SEARCHES long. */
function withFirst(list: string[], entry: string): string[] {
    return [entry, ...list.filter((one) => one !== entry)].slice(0, MAX_RECENT_SEARCHES);
}

/** Puts a chat opened from the search first in the recent searches, whichever tab it was found under. */
export function rememberRecentRoom(roomId: string): void {
    const recents = SettingsStore.getValue("SpotlightSearch.recentSearches", null);
    void SettingsStore.setValue(
        "SpotlightSearch.recentSearches",
        null,
        SettingLevel.ACCOUNT,
        withFirst(recents, roomId),
    );
}

/** Puts the words that found an opened message first in the recent message searches. */
export function rememberRecentMessageSearch(term: string): void {
    const trimmed = term.trim();
    if (!trimmed) return;
    const recents = SettingsStore.getValue("SpotlightSearch.recentMessageSearches", null);
    void SettingsStore.setValue(
        "SpotlightSearch.recentMessageSearches",
        null,
        SettingLevel.ACCOUNT,
        withFirst(recents, trimmed),
    );
}

export const useRecentSearches = (): [Room[], () => void] => {
    const [rooms, setRooms] = useState(() => {
        const cli = MatrixClientPeg.safeGet();
        const recents = SettingsStore.getValue("SpotlightSearch.recentSearches", null);
        return filterBoolean(recents.map((r) => cli.getRoom(r)));
    });

    return [
        rooms,
        () => {
            void SettingsStore.setValue("SpotlightSearch.recentSearches", null, SettingLevel.ACCOUNT, []);
            setRooms([]);
        },
    ];
};

/** The words recently used to find a message, most recent first, and a way to forget them. */
export const useRecentMessageSearches = (): [string[], () => void] => {
    const [terms, setTerms] = useState(() => SettingsStore.getValue("SpotlightSearch.recentMessageSearches", null));

    return [
        terms,
        () => {
            void SettingsStore.setValue("SpotlightSearch.recentMessageSearches", null, SettingLevel.ACCOUNT, []);
            setTerms([]);
        },
    ];
};
