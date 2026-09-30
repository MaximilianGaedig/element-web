/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect } from "vitest";
import { EventType, MatrixEvent, PendingEventOrdering, Room } from "matrix-js-sdk/src/matrix";

import { callHistory, indexedCallHistory } from "./calls";
import { mkEvent, mkMembership, stubClient } from "test-utils";

const ROOM_ID = "!dm:example.org";
const BOT = "@facebookbot:example.org";
const GHOST = "@facebook_1:example.org";

function bridgedDm(): { room: Room; client: ReturnType<typeof stubClient> } {
    const client = stubClient();
    const me = client.getSafeUserId();
    const room = new Room(ROOM_ID, client, me, { pendingEventOrdering: PendingEventOrdering.Detached });
    room.currentState.setStateEvents([
        ...[me, BOT, GHOST].map((user) =>
            mkMembership({
                event: true,
                room: ROOM_ID,
                user,
                mship: "join",
                name: user === GHOST ? "Richard" : undefined,
            }),
        ),
        mkEvent({
            event: true,
            type: "m.bridge",
            skey: "facebook",
            room: ROOM_ID,
            user: BOT,
            content: {
                "bridgebot": BOT,
                "protocol": { id: "facebook", displayname: "Messenger" },
                "com.beeper.room_type": "dm",
            },
        }),
    ]);
    (client.getRooms as any).mockReturnValue([room]);
    (client as any).getVisibleRooms = () => [room];
    return { room, client };
}

describe("callHistory", () => {
    // A bridged DM holds the bridge's bot too; counting its members made every call in it a group call,
    // and the bridge's own line about the call came out as a second call "from" its bot.
    it("shows a call in a bridged DM once, as a call with that person", () => {
        const { room, client } = bridgedDm();
        const start = Date.now() - 60_000;
        room.getLiveTimeline().addEvent(
            mkEvent({
                event: true,
                type: EventType.RTCNotification,
                room: ROOM_ID,
                user: GHOST,
                ts: start,
                content: { notification_type: "ring" },
            }),
            { toStartOfTimeline: false, addToState: false },
        );
        room.getLiveTimeline().addEvent(
            mkEvent({
                event: true,
                type: EventType.RoomMessage,
                room: ROOM_ID,
                user: BOT,
                ts: start + 1000,
                content: {
                    "msgtype": "m.notice",
                    "body": "Voice call",
                    "com.beeper.action_message": { type: "call", call_type: "voice" },
                },
            }),
            { toStartOfTimeline: false, addToState: false },
        );

        const calls = callHistory(client);

        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({ userId: GHOST, group: false });
    });

    // The loaded timeline reaches back only a few hundred events; the server's index has every call.
    it("lists calls the server indexed that the loaded timeline doesn't hold", async () => {
        const { client } = bridgedDm();
        const old = mkEvent({
            event: true,
            type: EventType.RTCNotification,
            room: ROOM_ID,
            user: GHOST,
            ts: 1_000,
            content: {},
        });
        (client as any).doesServerSupportUnstableFeature = async () => true;
        (client as any).getEventMapper = () => (raw: any) => new MatrixEvent(raw);
        (client as any).http = {
            authedRequest: async (_m: string, path: string, query: Record<string, string>) => {
                expect(path).toBe("/media");
                expect(query.kind).toBe("calls");
                return { chunk: [old.event], rooms: [ROOM_ID] };
            },
        };

        const calls = await indexedCallHistory(client);

        expect(calls).toHaveLength(1);
        expect(calls![0]).toMatchObject({ eventId: old.getId(), userId: GHOST, group: false });
    });

    it("gives up on the index where the server keeps none", async () => {
        const { client } = bridgedDm();
        (client as any).doesServerSupportUnstableFeature = async () => false;
        expect(await indexedCallHistory(client)).toBeUndefined();
    });
});
