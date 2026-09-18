/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type MatrixEvent } from "matrix-js-sdk/src/matrix";

import { MatrixClientPeg } from "../../MatrixClientPeg";
import { hasDisappeared } from "./disappearingMessages";

/**
 * Timeline hiding rules for Beeper/mautrix bridge extensions, consulted by shouldHideEvent.
 */
export function shouldHideBeeperEvent(ev: MatrixEvent): boolean {
    const client = MatrixClientPeg.get();
    if (!client) return false;
    // Disappearing messages whose timer ran out; the bridge redacts them soon, but don't wait.
    return hasDisappeared(ev, client.getRoom(ev.getRoomId()), client.getSafeUserId());
}
