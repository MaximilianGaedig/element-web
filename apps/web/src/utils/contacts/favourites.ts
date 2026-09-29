/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The people the reader already said matter, above the call list.
 *
 * A call list is opened to reach somebody, and most of the time it is somebody reached often - who is
 * further down the list the more calls there have been since. The favourite tag is the reader's own answer
 * to "who matters", kept on the account and already used by the room list, so this reads it rather than
 * asking the same question again in a second place.
 *
 * Direct chats only: a favourite space or group is a place, not a person, and has no one to call.
 */

import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";

import DMRoomMap from "../DMRoomMap";

/** Element's tag for a favourite, as the room list writes it. */
const FAVOURITE_TAG = "m.favourite";

/** One favourite, as a row of faces needs it. */
export interface Favourite {
    roomId: string;
    name: string;
    avatarUrl?: string;
}

/**
 * The reader's own order: the tag's `order` where they have dragged one into place, then the rest by name.
 *
 * Ordered tags sort before unordered ones rather than around them, because an order of 0.5 says where that
 * room goes among the ordered rooms and nothing at all about a room that has no order to compare with.
 */
function byReadersOrder(a: Room, b: Room): number {
    const [x, y] = [a.tags[FAVOURITE_TAG].order, b.tags[FAVOURITE_TAG].order];
    if (typeof x === "number" && typeof y === "number") return x - y;
    if (typeof x === "number") return -1;
    if (typeof y === "number") return 1;
    return a.name.localeCompare(b.name);
}

/** The favourite direct chats, in the order the reader put them in. */
export function favourites(client: MatrixClient, { limit = 12 }: { limit?: number } = {}): Favourite[] {
    const dms = DMRoomMap.shared().getRoomIds();
    return client
        .getVisibleRooms()
        .filter((room) => dms.has(room.roomId) && room.tags[FAVOURITE_TAG])
        .sort(byReadersOrder)
        .slice(0, limit)
        .map((room) => ({
            roomId: room.roomId,
            name: room.name,
            // A direct chat rarely has an avatar of its own; the face the reader knows is the other member's.
            avatarUrl: room.getMxcAvatarUrl() ?? room.getAvatarFallbackMember()?.getMxcAvatarUrl() ?? undefined,
        }));
}
