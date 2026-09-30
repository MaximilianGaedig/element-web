/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Sending the message you just wrote, even when older ones in the same room did not go out.
 *
 * The SDK holds back every new message in a room that has an unsent one: it is marked not sent on the spot
 * ("blocked by other events not yet sent") and never tried, so one send cut off by a reload or a dropped
 * connection kept everything written in that room afterwards from being sent at all.
 *
 * Only the message just written is sent. The older unsent ones are left exactly as they are - shown as
 * unsent, with resend and delete - because whether they should still go out is the reader's decision: an
 * automatic resend delivered messages hours after they were written, which is not what anyone wrote them
 * for. "Just written" is told apart from a message restored from storage at startup (which is also unsent
 * and carries no error) by its timestamp, which is when it was written and survives the restore.
 */

import { EventStatus, type MatrixClient, type MatrixEvent, type Room, RoomEvent } from "matrix-js-sdk/src/matrix";
import { logger as rootLogger } from "matrix-js-sdk/src/logger";

const logger = rootLogger.getChild("UnsentResender");

/** How recently a message was written for it to count as the one being sent now. */
const JUST_WRITTEN_MS = 10_000;

/** Whether this is a message written a moment ago and held back before it was ever tried. */
export function heldBackJustNow(event: MatrixEvent, now = Date.now()): boolean {
    return event.status === EventStatus.NOT_SENT && !event.error && now - event.getTs() < JUST_WRITTEN_MS;
}

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

    private constructor(private readonly client: MatrixClient) {
        client.on(RoomEvent.LocalEchoUpdated, this.onLocalEcho);
    }

    private dispose(): void {
        this.client.off(RoomEvent.LocalEchoUpdated, this.onLocalEcho);
    }

    private readonly onLocalEcho = (event: MatrixEvent, room: Room): void => {
        if (!heldBackJustNow(event)) return;
        // A failure here marks it failed like any other send, and it stays in the room as unsent.
        this.client.resendEvent(event, room).catch((e) => logger.info(`Sending a held-back message failed`, e));
    };
}
