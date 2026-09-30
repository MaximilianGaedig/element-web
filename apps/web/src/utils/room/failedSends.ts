/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * What of yours failed to send about a message, for Telegram's red "!" on it (tweb bubbles.ts
 * setBubbleSendingStatus: sendingerror). Telegram has no banner for unsent messages: the failure sits on
 * the message it concerns, and tapping it offers to resend or delete. Besides the message itself that
 * covers an edit of it, its deletion, a reaction to it and a thread reply under it - none of which shows
 * as a message of its own in the main timeline.
 */

import { useEffect, useState } from "react";
import { EventStatus, type MatrixEvent, type Room, RoomEvent } from "matrix-js-sdk/src/matrix";

import Resend from "../../Resend";

/** The message a pending event is about: what it edits, reacts to, deletes or replies in the thread of. */
function targetOf(pending: MatrixEvent): string | undefined {
    if (pending.isRedaction()) return pending.event.redacts ?? pending.getContent().redacts;
    return pending.getRelation()?.event_id;
}

/** Your failed sends about `event`, the event itself first when it failed. */
export function failedSendsFor(event: MatrixEvent, room: Room | null | undefined): MatrixEvent[] {
    const failed: MatrixEvent[] = [];
    if (event.status === EventStatus.NOT_SENT) failed.push(event);
    const id = event.getId();
    if (!room || !id) return failed;
    for (const pending of room.getPendingEvents()) {
        if (pending !== event && pending.status === EventStatus.NOT_SENT && targetOf(pending) === id) {
            failed.push(pending);
        }
    }
    return failed;
}

/** failedSendsFor, kept current as sends fail, are retried and go through. */
export function useFailedSends(event: MatrixEvent, room: Room | null | undefined): MatrixEvent[] {
    const [failed, setFailed] = useState(() => failedSendsFor(event, room));
    useEffect(() => {
        const update = (): void => {
            setFailed((prev) => {
                const next = failedSendsFor(event, room);
                return next.length === prev.length && next.every((e, i) => e === prev[i]) ? prev : next;
            });
        };
        update();
        if (!room) return;
        room.on(RoomEvent.LocalEchoUpdated, update);
        return () => {
            room.off(RoomEvent.LocalEchoUpdated, update);
        };
    }, [event, room]);
    return failed;
}

export function resendFailed(room: Room, failed: MatrixEvent[]): void {
    for (const event of failed) void Resend.resend(room.client, event);
}

export function deleteFailed(room: Room, failed: MatrixEvent[]): void {
    for (const event of failed) Resend.removeFromQueue(room.client, event);
}
