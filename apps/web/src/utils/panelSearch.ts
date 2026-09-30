/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * What this column is being searched for.
 *
 * Held here rather than in whichever list is showing, because the control that does the searching is not in
 * any of them: it is the bar at the foot of the column, which is also what moves between them. One search
 * serves the chats, the people and the calls - the reader searches "the column", not three separate boxes
 * that each have to be found first.
 *
 * Cleared whenever the view changes: a query typed while looking for a person means nothing against a list
 * of calls, and carrying it across would show an empty list the reader did not ask for.
 */

import { useSyncExternalStore } from "react";

interface Search {
    /** Whether the bar has become a search field. */
    open: boolean;
    query: string;
}

let state: Search = { open: false, query: "" };
const listeners = new Set<() => void>();

export const panelSearch = (): Search => state;

function tell(): void {
    // A copy, not the set: a listener may unsubscribe while being told, and mutating a Set mid-iteration
    // skips whoever came after it.
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const listener of [...listeners]) listener();
}

/** Opens or closes the search. Closing clears what was typed, since the list goes back to everything. */
export function setSearchOpen(open: boolean): void {
    if (state.open === open) return;
    state = { open, query: open ? state.query : "" };
    tell();
}

export function setSearchQuery(query: string): void {
    if (state.query === query) return;
    state = { ...state, query };
    tell();
}

/** Called when the column changes what it is showing, because a query does not carry across lists. */
export function clearSearch(): void {
    if (!state.open && !state.query) return;
    state = { open: false, query: "" };
    tell();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** The third argument is the same read: with no DOM to subscribe to, the value is still just the value. */
export const usePanelSearch = (): Search => useSyncExternalStore(subscribe, panelSearch, panelSearch);
