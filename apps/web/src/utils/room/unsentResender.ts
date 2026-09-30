/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Sending messages that did not go out, without being asked, as Telegram does.
 *
 * The SDK refuses to send anything in a room that holds an unsent message: every new message there is marked
 * not sent on the spot ("blocked by other events not yet sent") and never tried, so the reader can clear the
 * jam with Element's "resend all" banner. That banner is not shown in this layout's one-to-one chats, where
 * a failed message is meant to carry its own error - so one send cut off by a reload or a dropped connection
 * silently swallowed everything written in that room afterwards, and nothing ever tried again.
 *
 * So what can simply be tried again is: every room's unsent messages when the connection is back (which
 * includes starting up, when pending messages are restored from storage), and a room's as soon as a new
 * message there is held back behind them. In order, one at a time, stopping at the first that fails, so
 * messages arrive in the order they were written. A message the server itself refused (forbidden, too
 * large) is left alone: its bubble offers retry and delete, and trying it again unasked would only fail
 * again.
 */

import {
    ClientEvent,
    EventStatus,
    MatrixError,
    type MatrixClient,
    type MatrixEvent,
    type Room,
    RoomEvent,
    SyncState,
} from "matrix-js-sdk/src/matrix";
import { logger as rootLogger } from "matrix-js-sdk/src/logger";

const logger = rootLogger.getChild("UnsentResender");

/** Whether a failed send is worth trying again unasked: nothing the server said rules it out. */
export function isRetryable(event: MatrixEvent): boolean {
    if (event.status !== EventStatus.NOT_SENT) return false;
    // Typed as a MatrixError, but a dropped connection or a crypto check can leave any error here.
    const error: Error | null = event.error;
    // Never reached the server: restored from storage after a reload, or held back behind another.
    if (!error) return true;
    if (error instanceof MatrixError) {
        const status = error.httpStatus;
        // No status is a connection that failed; 429 and 5xx are the server asking to be asked later.
        return !status || status === 429 || status >= 500;
    }
    // Devices to verify first is a question for the reader, not something a retry answers.
    return error.name !== "UnknownDeviceError";
}

/**
 * Sends a room's retryable unsent messages in order, stopping at the first that fails again.
 *
 * The room is read again after each one rather than listed once up front: a message written while this runs
 * is held back behind the ones still going, and has to be picked up too.
 */
export async function resendRoom(client: MatrixClient, room: Room): Promise<void> {
    for (let next = room.getPendingEvents().find(isRetryable); next; next = room.getPendingEvents().find(isRetryable)) {
        try {
            await client.resendEvent(next, room);
        } catch (e) {
            logger.info(`Resending in ${room.roomId} stopped at a message that failed again`, e);
            return;
        }
    }
}

const SYNCING = new Set<SyncState | null>([SyncState.Prepared, SyncState.Syncing]);

export class UnsentResender {
    private static current?: UnsentResender;

    public static start(client: MatrixClient): void {
        UnsentResender.stop();
        UnsentResender.current = new UnsentResender(client);
    }

    public static stop(): void {
        UnsentResender.current?.dispose();
        UnsentResender.current = undefined;
    }

    /** Rooms being resent right now: a room is gone over once at a time, whatever asks for it again. */
    private readonly busy = new Set<string>();
    private connected = false;

    private constructor(private readonly client: MatrixClient) {
        client.on(ClientEvent.Sync, this.onSync);
        client.on(RoomEvent.LocalEchoUpdated, this.onLocalEcho);
        this.onSync(client.getSyncState());
    }

    private dispose(): void {
        this.client.off(ClientEvent.Sync, this.onSync);
        this.client.off(RoomEvent.LocalEchoUpdated, this.onLocalEcho);
    }

    private readonly onSync = (state: SyncState | null): void => {
        const connected = SYNCING.has(state);
        const cameBack = connected && !this.connected;
        this.connected = connected;
        if (!cameBack) return;
        for (const room of this.client.getRooms()) {
            if (room.getPendingEvents().some(isRetryable)) this.resend(room);
        }
    };

    /*
     * A message that was held back before it was tried carries no error: that is what a new message behind
     * an unsent one looks like. One that failed carries the failure, and is left for the next reconnect -
     * reacting to those here would retry a failing send in a loop.
     */
    private readonly onLocalEcho = (event: MatrixEvent, room: Room): void => {
        if (!this.connected || event.status !== EventStatus.NOT_SENT || event.error) return;
        this.resend(room);
    };

    private resend(room: Room): void {
        if (this.busy.has(room.roomId)) return;
        this.busy.add(room.roomId);
        void resendRoom(this.client, room).finally(() => this.busy.delete(room.roomId));
    }
}
