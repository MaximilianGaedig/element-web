/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The room the address book is kept in, as far as the room list needs to know about it.
 *
 * A leaf on purpose: the room list and the spotlight import this to leave the room out, and pulling the
 * whole of the address book's storage (addressBook.ts) into them would put the contacts code on the
 * startup path for nothing.
 */

import { type Room } from "matrix-js-sdk/src/matrix";

/** The `type` in the room's m.room.create, which is what tells it apart from a chat. */
export const CONTACTS_ROOM_TYPE = "im.mxg.contacts";

/** Whether this is the address book's own room: storage, not a chat, so it is never listed as one. */
export const isAddressBookRoom = (room: Room): boolean => room.getType() === CONTACTS_ROOM_TYPE;
