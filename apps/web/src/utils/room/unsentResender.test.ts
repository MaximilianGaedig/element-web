/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// oxlint-disable-next-line no-restricted-imports
import { EventEmitter } from "events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    ClientEvent,
    EventStatus,
    MatrixError,
    type MatrixClient,
    MatrixEvent,
    type Room,
    RoomEvent,
    SyncState,
} from "matrix-js-sdk/src/matrix";

import { heldBackJustNow, UnsentResender } from "./unsentResender";

const unsent = (writtenAgoMs: number, error?: MatrixError): MatrixEvent => {
    const event = new MatrixEvent({
        type: "m.room.message",
        origin_server_ts: Date.now() - writtenAgoMs,
        content: { msgtype: "m.text", body: "hi" },
    });
    event.status = EventStatus.NOT_SENT;
    if (error) event.error = error;
    return event;
};

function setup() {
    const room = { roomId: "!r:e" } as unknown as Room;
    const client = Object.assign(new EventEmitter(), {
        resendEvent: vi.fn(async () => ({ event_id: "$e" })),
    }) as unknown as MatrixClient;
    return { room, client };
}

afterEach(() => UnsentResender.stop());

describe("heldBackJustNow", () => {
    it("is a message written a moment ago that was never tried", () => {
        expect(heldBackJustNow(unsent(500))).toBe(true);
    });

    /* Restored from storage after a reload: unsent and without an error too, but written long ago. */
    it("is not an old unsent message restored at startup", () => {
        expect(heldBackJustNow(unsent(12 * 60 * 60 * 1000))).toBe(false);
    });

    it("is not a message that was tried and failed", () => {
        expect(heldBackJustNow(unsent(500, new MatrixError({}, 502)))).toBe(false);
    });
});

describe("UnsentResender", () => {
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

    it("sends a message just written that was held back behind an unsent one", async () => {
        const { client, room } = setup();
        UnsentResender.start(client);
        const blocked = unsent(100);
        client.emit(RoomEvent.LocalEchoUpdated, blocked, room);
        await settle();
        expect(client.resendEvent).toHaveBeenCalledWith(blocked, room);
    });

    /* Whether old unsent messages still go out is the reader's call, made from the banner or the bubble. */
    it("never sends old unsent messages by itself, not even when the connection comes back", async () => {
        const { client, room } = setup();
        UnsentResender.start(client);
        client.emit(ClientEvent.Sync, SyncState.Syncing, null);
        client.emit(RoomEvent.LocalEchoUpdated, unsent(12 * 60 * 60 * 1000), room);
        await settle();
        expect(client.resendEvent).not.toHaveBeenCalled();
    });

    it("does not retry a send that just failed", async () => {
        const { client, room } = setup();
        UnsentResender.start(client);
        client.emit(RoomEvent.LocalEchoUpdated, unsent(100, new MatrixError({}, 502)), room);
        await settle();
        expect(client.resendEvent).not.toHaveBeenCalled();
    });
});
