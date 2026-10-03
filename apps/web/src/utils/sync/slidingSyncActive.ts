/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Whether this session's client syncs with sliding sync.
 *
 * The setting only says sliding sync is wanted: a server without it gets the other sync, and the code that
 * works differently under each (members, presence, opening a room) must go by which one is running. It is
 * set where the client is started (MatrixClientPeg) and imports nothing, so any store may read it.
 */

let active = false;

export function isSlidingSyncActive(): boolean {
    return active;
}

export function setSlidingSyncActive(value: boolean): void {
    active = value;
}
