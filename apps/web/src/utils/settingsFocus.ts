/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Asking the settings' list to take the keyboard focus: its search field (from the bar at the foot of the
 * column) or one of its rows (from the section that was opened out of it, on Escape).
 *
 * The asker is not inside the list, and on a phone the list may not even be mounted yet (a section is open
 * over it, and the request is what takes you back to it), so the request is kept until the list takes it
 * rather than being a call that is lost when nobody is listening.
 */

import { type UserTab } from "../components/views/dialogs/UserTab";

export type SettingsFocusTarget = "search" | UserTab;

let pending: SettingsFocusTarget | undefined;
let take: (() => void) | undefined;

export function requestSettingsFocus(target: SettingsFocusTarget): void {
    pending = target;
    take?.();
}

/** The list says it is there; whatever was asked of it before it was, it does now. Returns the undo. */
export function onSettingsFocusRequest(focus: (target: SettingsFocusTarget) => void): () => void {
    const run = (): void => {
        if (pending === undefined) return;
        const target = pending;
        pending = undefined;
        focus(target);
    };
    take = run;
    run();
    return () => {
        if (take === run) take = undefined;
    };
}
