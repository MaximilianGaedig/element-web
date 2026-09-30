/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * What the left panel is showing.
 *
 * The room list's column is one place, not a stack of overlapping ones: a phone has no room for the
 * chat list and a contact list at once, and a dialog floating over the list is the desktop answer to a
 * problem a phone does not have. So contacts replace the list in place and a back control returns it,
 * which is how the Phone and Contacts apps behave on a handset.
 *
 * Held here rather than in the panel's own state because the things that open a view are elsewhere: a
 * button in the rail, a pill over the list, a keyboard shortcut later.
 */

import { useSyncExternalStore } from "react";

/*
 * The three things this column can be, which are the three entries in the bar at the bottom of it: the
 * chats, the people, and the calls. Contacts and calls are two views rather than one with a tab inside it
 * because the bar is what switches between them - a tab strip under a bar that already switches views is
 * the same control twice.
 */
export type RoomListPanelView = "rooms" | "contacts" | "calls";

let view: RoomListPanelView = "rooms";
const listeners = new Set<() => void>();

export const roomListPanelView = (): RoomListPanelView => view;

/** Opening a chat sends this back to "rooms": the conversation list is what belongs beside a conversation. */
export function setRoomListPanelView(next: RoomListPanelView): void {
    if (next === view) return;
    view = next;
    // A copy, not the set: a listener may unsubscribe while being told, and mutating a Set mid-iteration
    // skips whoever came after it.
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** The third argument is the same read: with no DOM to subscribe to, the value is still just the value. */
export const useRoomListPanelView = (): RoomListPanelView =>
    useSyncExternalStore(subscribe, roomListPanelView, roomListPanelView);
