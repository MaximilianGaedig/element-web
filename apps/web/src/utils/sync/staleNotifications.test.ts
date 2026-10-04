/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, expect, it, beforeEach } from "vitest";
import { MatrixEvent } from "matrix-js-sdk/src/matrix";

import {
    isStaleForNotification,
    noteRoomData,
    readStaleNotifications,
    recordStaleNotification,
    STALE_NOTIFICATION_AGE_MS,
} from "./staleNotifications";

const NOW = 1_800_000_000_000;

const mkEvent = (origin_server_ts?: number): MatrixEvent =>
    new MatrixEvent({ event_id: "$e", room_id: "!r:x", type: "m.room.message", origin_server_ts, content: {} });

describe("stale notifications", () => {
    beforeEach(() => localStorage.clear());

    it("judges by the event's own timestamp", () => {
        expect(isStaleForNotification(mkEvent(NOW - STALE_NOTIFICATION_AGE_MS - 1), NOW)).toBe(true);
        expect(isStaleForNotification(mkEvent(NOW - STALE_NOTIFICATION_AGE_MS + 1), NOW)).toBe(false);
    });

    it("does not judge an event with no timestamp", () => {
        expect(isStaleForNotification(mkEvent(undefined), NOW)).toBe(false);
    });

    it("keeps what the sync said about the room, with the skip", () => {
        noteRoomData(
            "!r:x",
            {
                initial: true,
                limited: true,
                num_live: 3,
                timeline: [
                    { event_id: "$a", origin_server_ts: 1 },
                    { event_id: "$e", origin_server_ts: 2 },
                ] as never,
            } as never,
            NOW - 5,
        );

        recordStaleNotification(mkEvent(NOW - 2 * STALE_NOTIFICATION_AGE_MS), "SYNCING", NOW);

        expect(readStaleNotifications()).toEqual([
            expect.objectContaining({
                roomId: "!r:x",
                eventId: "$e",
                syncState: "SYNCING",
                roomData: {
                    receivedAt: NOW - 5,
                    initial: true,
                    limited: true,
                    numLive: 3,
                    timeline: 2,
                    tail: ["$a@1", "$e@2"],
                },
            }),
        ]);
    });

    it("keeps only the latest records", () => {
        for (let i = 0; i < 25; i++) recordStaleNotification(mkEvent(1), undefined, NOW + i);

        const records = readStaleNotifications();
        expect(records).toHaveLength(20);
        expect(records[19].at).toBe(NOW + 24);
    });
});
