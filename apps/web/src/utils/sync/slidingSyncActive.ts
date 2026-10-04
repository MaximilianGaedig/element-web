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
let presenceExtensionActive = false;

export function isSlidingSyncActive(): boolean {
    return active;
}

export function setSlidingSyncActive(value: boolean): void {
    active = value;
    // The extension rides the sliding sync connection, so it ends with it.
    if (!value) presenceExtensionActive = false;
}

/**
 * Whether presence arrives inside the sliding sync connection, as the `im.mxg.presence` extension.
 * Then nothing else is asked for it: not the presence-only /sync long-poll, not the startup snapshot, not
 * the per-user poller.
 */
export function isSlidingSyncPresenceActive(): boolean {
    return active && presenceExtensionActive;
}

export function setSlidingSyncPresenceActive(value: boolean): void {
    presenceExtensionActive = value;
}
