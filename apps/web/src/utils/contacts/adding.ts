/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Whether a new contact is being written down.
 *
 * Held outside the contacts view because the control that starts it is not in that view: it is the +
 * beside the bar at the foot of the column, as iOS puts the compose button beside its tab bar. The view
 * shows the editor while this is set and clears it when the editor is done.
 */

import { useSyncExternalStore } from "react";

let adding = false;
const listeners = new Set<() => void>();

export const isAddingContact = (): boolean => adding;

export function setAddingContact(next: boolean): void {
    if (adding === next) return;
    adding = next;
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export const useAddingContact = (): boolean => useSyncExternalStore(subscribe, isAddingContact, isAddingContact);
