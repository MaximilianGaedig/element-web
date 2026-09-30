/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * What the two islands beside the bar at the foot of the column do, when a screen over the column wants them.
 *
 * The islands are search and add; a screen that has its own two answers - the duplicates' "ignore all" and
 * "merge all" - puts them there instead, so they sit where the reader's thumb already is rather than in a
 * row of their own above the bar. The screen sets them while it is open and clears them when it closes.
 */

import { useSyncExternalStore } from "react";

export interface BarAction {
    label: string;
    onClick: () => void;
    /** The action the screen is for, drawn as the primary one. */
    primary?: boolean;
}

export interface BarActions {
    start: BarAction;
    end: BarAction;
}

let current: BarActions | undefined;
const listeners = new Set<() => void>();

export const barActions = (): BarActions | undefined => current;

export function setBarActions(next: BarActions | undefined): void {
    if (current === next) return;
    current = next;
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export const useBarActions = (): BarActions | undefined => useSyncExternalStore(subscribe, barActions, barActions);
