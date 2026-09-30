/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";
import { EventStatus, MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";

import { failedSendsFor } from "./failedSends";

const message = (id: string, status: EventStatus | null = null): MatrixEvent => {
    const ev = new MatrixEvent({
        type: "m.room.message",
        event_id: id,
        room_id: "!r:x",
        sender: "@me:x",
        content: { msgtype: "m.text", body: "hi" },
    });
    ev.status = status;
    return ev;
};

const pending = (
    content: Record<string, unknown>,
    type = "m.room.message",
    extra: Record<string, unknown> = {},
): MatrixEvent => {
    const ev = new MatrixEvent({
        type,
        event_id: "~" + Math.random(),
        room_id: "!r:x",
        sender: "@me:x",
        content,
        ...extra,
    });
    ev.status = EventStatus.NOT_SENT;
    return ev;
};

const roomWith = (...events: MatrixEvent[]): Room => ({ getPendingEvents: () => events }) as unknown as Room;

describe("failedSendsFor", () => {
    it("is the message itself when it failed", () => {
        const failed = message("~local", EventStatus.NOT_SENT);
        expect(failedSendsFor(failed, roomWith(failed))).toEqual([failed]);
    });

    it("finds a failed edit, deletion and reaction of a sent message, and nothing else's", () => {
        const target = message("$sent");
        const edit = pending({
            "m.new_content": { body: "x" },
            "m.relates_to": { rel_type: "m.replace", event_id: "$sent" },
        });
        const reaction = pending(
            { "m.relates_to": { rel_type: "m.annotation", event_id: "$sent", key: "👍" } },
            "m.reaction",
        );
        const deletion = pending({}, "m.room.redaction", { redacts: "$sent" });
        const other = pending(
            { "m.relates_to": { rel_type: "m.annotation", event_id: "$other", key: "👍" } },
            "m.reaction",
        );
        const sending = pending(
            { "m.relates_to": { rel_type: "m.annotation", event_id: "$sent", key: "❤️" } },
            "m.reaction",
        );
        sending.status = EventStatus.SENDING;

        expect(failedSendsFor(target, roomWith(edit, reaction, deletion, other, sending))).toEqual([
            edit,
            reaction,
            deletion,
        ]);
    });

    it("doesn't count a failed reply as being about the message it quotes", () => {
        const target = message("$quoted");
        const reply = pending({ "body": "re", "m.relates_to": { "m.in_reply_to": { event_id: "$quoted" } } });
        expect(failedSendsFor(target, roomWith(reply))).toEqual([]);
    });

    it("is nothing for a sent message with nothing pending", () => {
        expect(failedSendsFor(message("$sent"), roomWith())).toEqual([]);
    });
});
