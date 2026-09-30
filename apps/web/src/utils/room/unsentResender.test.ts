/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// oxlint-disable-next-line no-restricted-imports
import { EventEmitter } from "events";
import { describe, expect, it, vi, afterEach } from "vitest";
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

import { isRetryable, resendRoom, UnsentResender } from "./unsentResender";

const unsent = (body: string, error?: Error): MatrixEvent => {
    const event = new MatrixEvent({ type: "m.room.message", content: { msgtype: "m.text", body } });
    event.status = EventStatus.NOT_SENT;
    if (error) event.error = error as MatrixError;
    return event;
};

/** A room whose pending list is the given events, and a client whose resends are recorded. */
function setup(pending: MatrixEvent[], fail: (event: MatrixEvent) => boolean = () => false) {
    const sent: string[] = [];
    const room = { roomId: "!r:e", getPendingEvents: () => pending } as unknown as Room;
    const client = Object.assign(new EventEmitter(), {
        getRooms: () => [room],
        getSyncState: (): SyncState | null => null,
        resendEvent: vi.fn(async (event: MatrixEvent) => {
            if (fail(event)) {
                event.error = new MatrixError({}, 502);
                throw event.error;
            }
            sent.push(event.getContent().body);
            event.status = EventStatus.SENT;
        }),
    }) as unknown as MatrixClient;
    return { room, client, sent };
}

afterEach(() => UnsentResender.stop());

describe("isRetryable", () => {
    it("retries a message that never reached the server", () => {
        expect(isRetryable(unsent("restored after a reload"))).toBe(true);
    });

    it("retries after a dropped connection, a server error or a rate limit", () => {
        expect(isRetryable(unsent("a", new MatrixError({}, undefined)))).toBe(true);
        expect(isRetryable(unsent("b", new MatrixError({}, 502)))).toBe(true);
        expect(isRetryable(unsent("c", new MatrixError({ errcode: "M_LIMIT_EXCEEDED" }, 429)))).toBe(true);
    });

    it("leaves alone what the server refused", () => {
        expect(isRetryable(unsent("a", new MatrixError({ errcode: "M_FORBIDDEN" }, 403)))).toBe(false);
        expect(isRetryable(unsent("b", new MatrixError({ errcode: "M_TOO_LARGE" }, 413)))).toBe(false);
    });

    it("leaves alone a message waiting on the reader to verify devices", () => {
        const error = Object.assign(new Error("unknown devices"), { name: "UnknownDeviceError" });
        expect(isRetryable(unsent("a", error))).toBe(false);
    });

    it("only concerns messages that did not go out", () => {
        const sending = unsent("a");
        sending.status = EventStatus.SENDING;
        expect(isRetryable(sending)).toBe(false);
    });
});

describe("resendRoom", () => {
    it("sends in the order they were written", async () => {
        const { client, room, sent } = setup([unsent("one"), unsent("two"), unsent("three")]);
        await resendRoom(client, room);
        expect(sent).toEqual(["one", "two", "three"]);
    });

    /* Sending the rest past one that failed would deliver them out of order. */
    it("stops at the first that fails again", async () => {
        const { client, room, sent } = setup(
            [unsent("one"), unsent("two"), unsent("three")],
            (e) => e.getContent().body === "two",
        );
        await resendRoom(client, room);
        expect(sent).toEqual(["one"]);
    });

    it("skips what the server refused and sends what comes after", async () => {
        const refused = unsent("refused", new MatrixError({ errcode: "M_FORBIDDEN" }, 403));
        const { client, room, sent } = setup([refused, unsent("after")]);
        await resendRoom(client, room);
        expect(sent).toEqual(["after"]);
    });

    it("picks up a message written while it runs", async () => {
        const pending = [unsent("one")];
        const { client, room, sent } = setup(pending);
        vi.mocked(client.resendEvent).mockImplementationOnce(async (event: MatrixEvent) => {
            pending.push(unsent("written meanwhile"));
            sent.push(event.getContent().body);
            event.status = EventStatus.SENT;
            return { event_id: "$1" };
        });
        await resendRoom(client, room);
        expect(sent).toEqual(["one", "written meanwhile"]);
    });
});

describe("UnsentResender", () => {
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

    /* Restored from storage at startup: sent as soon as the client is connected. */
    it("sends what is unsent when the connection comes back", async () => {
        const { client, sent } = setup([unsent("from last night")]);
        UnsentResender.start(client);
        expect(sent).toEqual([]);
        client.emit(ClientEvent.Sync, SyncState.Prepared, null);
        await settle();
        expect(sent).toEqual(["from last night"]);
    });

    /* The jam: a new message in a room with an unsent one is held back before it is tried. */
    it("sends a new message held back behind an unsent one, and the one ahead of it first", async () => {
        const earlier = unsent("earlier", new MatrixError({}, 502));
        const pending = [earlier];
        const { client, room, sent } = setup(pending);
        UnsentResender.start(client);
        client.emit(ClientEvent.Sync, SyncState.Syncing, null);
        await settle();
        sent.length = 0;
        earlier.status = EventStatus.NOT_SENT;

        const blocked = unsent("just written");
        pending.push(blocked);
        client.emit(RoomEvent.LocalEchoUpdated, blocked, room);
        await settle();
        expect(sent).toEqual(["earlier", "just written"]);
    });

    /* Reacting to a failure itself would retry a failing send in a loop; that waits for a reconnect. */
    it("does not retry a send that just failed", async () => {
        const failed = unsent("failed", new MatrixError({}, 502));
        const { client, room } = setup([]);
        UnsentResender.start(client);
        client.emit(ClientEvent.Sync, SyncState.Syncing, null);
        client.emit(RoomEvent.LocalEchoUpdated, failed, room);
        await settle();
        expect(client.resendEvent).not.toHaveBeenCalled();
    });

    it("does nothing while disconnected", async () => {
        const { client, room } = setup([unsent("a")]);
        UnsentResender.start(client);
        client.emit(RoomEvent.LocalEchoUpdated, unsent("b"), room);
        await settle();
        expect(client.resendEvent).not.toHaveBeenCalled();
    });
});
