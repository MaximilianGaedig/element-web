/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type Room } from "matrix-js-sdk/src/matrix";

import DMRoomMap from "../DMRoomMap";
import { isBridgedDm } from "../bridge/bridgeInfo";

/**
 * Whether the room is a direct message: one Element knows about (`m.direct`), or one a bridge says is
 * a chat with a single person on its network. The latter is not in `m.direct`, so the room list would
 * otherwise put every bridged DM under Rooms instead of People.
 */
export function isDirectMessage(room: Room): boolean {
    return !!DMRoomMap.shared()?.getUserIdForRoomId(room.roomId) || isBridgedDm(room);
}
