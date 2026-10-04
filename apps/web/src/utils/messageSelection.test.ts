/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { EventStatus, MatrixEvent, Room } from "matrix-js-sdk/src/matrix";
import { stubClient } from "test-utils";

import { isSelectableEvent, selectionAsText } from "./messageSelection";

const ROOM = "!r:x";

function message(id: string, sender: string, body: string, ts: number): MatrixEvent {
    return new MatrixEvent({
        type: "m.room.message",
        event_id: id,
        room_id: ROOM,
        sender,
        origin_server_ts: ts,
        content: { msgtype: "m.text", body },
    });
}

describe("selectionAsText", () => {
    const client = stubClient();
    const room = new Room(ROOM, client, client.getSafeUserId());

    it("copies one message as its text alone", () => {
        expect(selectionAsText(room, [message("$a", "@ada:x", "hello", 1)])).toBe("hello");
    });

    it("copies several as one line each, oldest first, with the date and who said it", () => {
        const later = message("$b", "@bob:x", "second", Date.UTC(2026, 9, 4, 18, 6));
        const earlier = message("$a", "@ada:x", "first", Date.UTC(2026, 9, 4, 18, 5));

        const lines = selectionAsText(room, [later, earlier]).split("\n");

        expect(lines).toHaveLength(2);
        expect(lines[0]).toMatch(/^\[.+\] @ada:x: first$/);
        expect(lines[1]).toMatch(/^\[.+\] @bob:x: second$/);
    });

    it("leaves out messages without text", () => {
        const call = new MatrixEvent({
            type: "m.call.invite",
            event_id: "$c",
            room_id: ROOM,
            sender: "@ada:x",
            content: {},
        });

        expect(selectionAsText(room, [call, message("$a", "@ada:x", "only this", 1)])).toBe("only this");
    });
});

describe("isSelectableEvent", () => {
    const client = stubClient();

    it("takes a message, not a reaction, and not one still sending", () => {
        const reaction = new MatrixEvent({
            type: "m.reaction",
            event_id: "$r",
            room_id: ROOM,
            sender: "@ada:x",
            content: { "m.relates_to": { rel_type: "m.annotation", event_id: "$a", key: "👍" } },
        });
        const sending = message("$s", "@me:x", "on its way", 1);
        sending.setStatus(EventStatus.SENDING);

        expect(isSelectableEvent(message("$a", "@ada:x", "hi", 1), client)).toBe(true);
        expect(isSelectableEvent(reaction, client)).toBe(false);
        expect(isSelectableEvent(sending, client)).toBe(false);
    });
});
