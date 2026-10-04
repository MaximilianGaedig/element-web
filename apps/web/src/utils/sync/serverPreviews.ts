/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Each room's newest message, as the server last sent it for the chat list (`im.mxg.preview`).
 *
 * Sliding sync's lists ask for each room's last ten events so that the message the chat list shows is among
 * them, but in a bridged chat those can all be reactions and delivery statuses, and the chat then showed no
 * preview at all. A server that advertises `im.mxg.msc4186.preview` sends the newest message with a room
 * whose timeline shows none, and the chat list falls back to it here (MessagePreviewStore).
 *
 * The lists keep asking for ten: with one, a room whose newest event is a reaction or a status would start
 * with an empty timeline (the SDK leaves relations to unknown events out of it), so neither the screen nor
 * the stored history (utils/history/localHistory) would have an event to start from.
 */

import { type IRoomEvent, type MatrixClient, type MatrixEvent, TypedEventEmitter } from "matrix-js-sdk/src/matrix";

/** Where a sliding sync room carries its preview. */
export const PREVIEW_FIELD = "im.mxg.preview";

/** Emitted with the room ID when a room's preview changes. */
export const SERVER_PREVIEW_CHANGED = "server_preview_changed";

const previews = new Map<string, MatrixEvent>();
const emitter = new TypedEventEmitter<
    typeof SERVER_PREVIEW_CHANGED,
    { [SERVER_PREVIEW_CHANGED]: (roomId: string) => void }
>();

/** The room's newest message as the server last sent it, if it sent one. */
export function serverPreviewFor(roomId: string): MatrixEvent | undefined {
    return previews.get(roomId);
}

/** Keeps a room's preview as the server sent it, live or from the last session's cache. */
export function setServerPreview(client: MatrixClient, roomId: string, raw: IRoomEvent): void {
    if (previews.get(roomId)?.getId() === raw.event_id) return;
    const event = client.getEventMapper()({ ...raw, room_id: roomId });
    previews.set(roomId, event);
    // An encrypted message decrypts in the background, and the chat list hears of it like any other.
    void client.decryptEventIfNeeded(event);
    emitter.emit(SERVER_PREVIEW_CHANGED, roomId);
}

/** Calls back with the room ID whenever a room's preview changes; returns how to stop. */
export function onServerPreviewChanged(listener: (roomId: string) => void): () => void {
    emitter.on(SERVER_PREVIEW_CHANGED, listener);
    return () => emitter.off(SERVER_PREVIEW_CHANGED, listener);
}

/** On logout, with the rest of the session. */
export function clearServerPreviews(): void {
    previews.clear();
}
