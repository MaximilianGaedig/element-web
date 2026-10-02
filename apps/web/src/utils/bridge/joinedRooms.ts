/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { KnownMembership } from "matrix-js-sdk/src/types";
import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";

/**
 * The rooms to read what a bridge says about itself from: the ones we are in.
 *
 * The client keeps a room it has left, with the state it last saw there, and that state never changes
 * again. Read from every room, a bridge we said goodbye to - its bot's chat left, its bridge replaced -
 * went on being listed with its last login, its settings and a chat to open that we are no longer in.
 */
export function joinedRooms(client: MatrixClient): Room[] {
    return client.getRooms().filter((room) => room.getMyMembership() === KnownMembership.Join);
}
