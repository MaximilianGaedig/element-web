/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { isSlidingSyncPresenceActive } from "../sync/slidingSyncActive";
import { PresencePoller } from "./PresencePoller";
import { PresenceSyncLoop } from "./PresenceSyncLoop";

/**
 * Starts whatever delivers other people's presence to this client.
 *
 * Where the homeserver puts presence in the sliding sync connection, that is all there is: no second
 * long-poll, no startup snapshot, no poller. Otherwise simplified sliding sync gets a presence-only /sync
 * long-poll beside it (falling back to polling /presence for DM partners while that keeps failing), and
 * the v2 sync, which delivers only changes, gets everyone's current presence once.
 */
export function startPresenceDelivery(client: MatrixClient, getOpenRoomId: () => string | null | undefined): void {
    if (isSlidingSyncPresenceActive()) return;

    if (!PresenceSyncLoop.isApplicable(client)) void PresenceSyncLoop.snapshot(client);
    PresenceSyncLoop.start(client, {
        onFallback: (active) => {
            if (active) {
                PresencePoller.start(client, { getOpenRoomId });
            } else {
                PresencePoller.stop();
            }
        },
    });
}

export function stopPresenceDelivery(): void {
    PresenceSyncLoop.stop();
    PresencePoller.stop();
}
