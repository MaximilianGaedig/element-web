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

describe("callHistory: group calls", () => {
    const GROUP_ID = "!group:example.org";
    const ADA = "@ada:example.org";
    const BEN = "@ben:example.org";
    const CYD = "@cyd:example.org";
    const MIN = 60_000;
    const HOUR = 60 * MIN;

    function groupRoom(): { room: Room; client: ReturnType<typeof stubClient>; me: string } {
        const client = stubClient();
        const me = client.getSafeUserId();
        const room = new Room(GROUP_ID, client, me, { pendingEventOrdering: PendingEventOrdering.Detached });
        room.currentState.setStateEvents(
            [me, ADA, BEN, CYD].map((user) =>
                mkMembership({ event: true, room: GROUP_ID, user, mship: "join", name: user.slice(1, 4) }),
            ),
        );
        (client.getRooms as any).mockReturnValue([room]);
        (client as any).getVisibleRooms = () => [room];
        return { room, client, me };
    }

    const add = (room: Room, event: MatrixEvent): void => {
        room.getLiveTimeline().addEvent(event, { toStartOfTimeline: false, addToState: false });
    };
    const ring = (room: Room, user: string, ts: number, content: object = {}): void =>
        add(room, mkEvent({ event: true, type: EventType.RTCNotification, room: GROUP_ID, user, ts, content }));
    // Element Call's own membership: per device state, emptied to leave.
    const join = (room: Room, user: string, ts: number, content: object = {}): void =>
        add(
            room,
            mkEvent({
                event: true,
                type: EventType.RTCMembership,
                room: GROUP_ID,
                user,
                skey: `_${user}_DEV`,
                ts,
                content: { application: "m.call", device_id: "DEV", ...content },
            }),
        );
    const leave = (room: Room, user: string, ts: number): void =>
        add(
            room,
            mkEvent({
                event: true,
                type: EventType.RTCMembership,
                room: GROUP_ID,
                user,
                skey: `_${user}_DEV`,
                ts,
                content: {},
            }),
        );

    // The report: one group call listed once per member who joined it.
    it("shows a call every member joined as one entry with all of them in it", () => {
        const { room, client } = groupRoom();
        const t0 = Date.now() - 5 * HOUR;
        ring(room, ADA, t0);
        ring(room, BEN, t0 + 5_000);
        ring(room, CYD, t0 + 9_000);
        join(room, ADA, t0 + 1_000);
        join(room, BEN, t0 + 6_000);
        join(room, CYD, t0 + 10_000);
        leave(room, CYD, t0 + 20 * MIN);
        leave(room, BEN, t0 + 30 * MIN);
        leave(room, ADA, t0 + 45 * MIN);

        const calls = callHistory(client);

        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({
            group: true,
            title: room.name,
            userId: ADA,
            ts: t0,
            endTs: t0 + 45 * MIN,
            seconds: 45 * 60,
            ongoing: false,
        });
        expect(calls[0].participants!.map((p) => p.userId)).toEqual([ADA, BEN, CYD]);
    });

    it("keeps a rejoin shortly after everyone left in the same call", () => {
        const { room, client } = groupRoom();
        const t0 = Date.now() - 5 * HOUR;
        join(room, ADA, t0);
        leave(room, ADA, t0 + 10 * MIN);
        join(room, ADA, t0 + 12 * MIN);
        leave(room, ADA, t0 + 20 * MIN);

        const calls = callHistory(client);

        expect(calls).toHaveLength(1);
        expect(calls[0].seconds).toBe(20 * 60);
    });

    it("lists two calls in the same room hours apart as two entries", () => {
        const { room, client } = groupRoom();
        const t0 = Date.now() - 6 * HOUR;
        join(room, ADA, t0);
        join(room, BEN, t0 + MIN);
        leave(room, ADA, t0 + 10 * MIN);
        leave(room, BEN, t0 + 11 * MIN);
        join(room, CYD, t0 + 3 * HOUR);
        leave(room, CYD, t0 + 3 * HOUR + 5 * MIN);

        const calls = callHistory(client);

        expect(calls.map((c) => c.userId)).toEqual([CYD, ADA]);
        expect(calls[1].participants).toHaveLength(2);
    });

    it("splits notifications with no memberships by the gap between them", () => {
        const { room, client } = groupRoom();
        const t0 = Date.now() - 5 * HOUR;
        for (const offset of [0, 1000, 2000, 3000]) ring(room, ADA, t0 + offset);
        ring(room, BEN, t0 + 74 * MIN);
        ring(room, BEN, t0 + 74 * MIN + 1000);

        expect(callHistory(client)).toHaveLength(2);
    });

    it("marks a call somebody is still in as ongoing, without an end", () => {
        const { room, client } = groupRoom();
        const t0 = Date.now() - 10 * MIN;
        join(room, ADA, t0);
        join(room, BEN, t0 + MIN);
        leave(room, BEN, t0 + 2 * MIN);

        const [call] = callHistory(client);

        expect(call).toMatchObject({ ongoing: true, endTs: undefined, seconds: undefined });
    });

    it("says whether the reader joined it, and which one they missed", () => {
        const { room, client, me } = groupRoom();
        const t0 = Date.now() - 5 * HOUR;
        // Rung for and not in it: missed.
        ring(room, ADA, t0, { "m.mentions": { room: true } });
        join(room, ADA, t0 + 1000);
        leave(room, ADA, t0 + 5 * MIN);
        // Joined.
        join(room, ADA, t0 + 2 * HOUR);
        join(room, me, t0 + 2 * HOUR + MIN);
        leave(room, ADA, t0 + 2 * HOUR + 9 * MIN);
        leave(room, me, t0 + 2 * HOUR + 10 * MIN);
        // Happened, with nobody ringing the reader and the reader not in it: neither.
        join(room, BEN, t0 + 4 * HOUR);
        leave(room, BEN, t0 + 4 * HOUR + MIN);

        const [none, joined, missed] = callHistory(client);

        expect(missed).toMatchObject({ outcome: "missed", joined: false });
        expect(joined).toMatchObject({ outcome: "answered", joined: true });
        expect(joined.participants!.find((p) => p.you)?.userId).toBe(me);
        expect(none).toMatchObject({ outcome: "unknown", joined: false });
    });

    it("knows the reader started it, and that they turned it down", () => {
        const { room, client, me } = groupRoom();
        const t0 = Date.now() - 5 * HOUR;
        ring(room, me, t0);
        join(room, me, t0 + 1000);
        leave(room, me, t0 + MIN);
        ring(room, ADA, t0 + 2 * HOUR);
        add(
            room,
            mkEvent({
                event: true,
                type: EventType.RTCDecline,
                room: GROUP_ID,
                user: me,
                ts: t0 + 2 * HOUR + 5000,
                content: {},
            }),
        );

        const [declined, started] = callHistory(client);

        expect(started).toMatchObject({ outgoing: true, outcome: "answered" });
        expect(declined).toMatchObject({ outgoing: false, outcome: "declined" });
    });

    it("reads video from the call's intent", () => {
        const { room, client } = groupRoom();
        ring(room, ADA, Date.now() - HOUR, { "m.call.intent": "video" });
        expect(callHistory(client)[0].video).toBe(true);
    });

    it("keeps one entry per call when the index lists each member's notification", async () => {
        const { room, client } = groupRoom();
        const t0 = Date.now() - 5 * HOUR;
        const rings = [ADA, BEN, CYD].map((user, i) =>
            mkEvent({
                event: true,
                type: EventType.RTCNotification,
                room: GROUP_ID,
                user,
                ts: t0 + i * 1000,
                content: {},
            }),
        );
        for (const r of rings) add(room, r);
        (client as any).doesServerSupportUnstableFeature = async () => true;
        (client as any).getEventMapper = () => (raw: any) => new MatrixEvent(raw);
        (client as any).http = {
            authedRequest: async () => ({ chunk: rings.map((r) => r.event), rooms: rings.map(() => GROUP_ID) }),
        };

        expect(await indexedCallHistory(client)).toHaveLength(1);
    });
});
