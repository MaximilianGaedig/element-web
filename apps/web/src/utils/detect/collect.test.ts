/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The sweep must never walk the whole history in one go.
 *
 * It did, once: the first version built a list of every loaded event in every room before it read any of
 * them, inside a single idle callback. Deferring the *detection* was not enough - the walk itself pegged
 * the renderer, and the app came up unable to paint, answer a script or take a click.
 *
 * So the thing to hold onto is not "detection is off the render path" but "no turn ever touches more than
 * a fixed number of events". That is what this measures, by counting how many events the sweep inspects
 * before it yields.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { startCollecting } from "./collect";

/** How many events one turn may inspect, as collect.ts sets it. Kept here so a change to it fails loudly. */
const SCANNED_PER_TURN = 100;

/**
 * A message in the history.
 *
 * Whether it is a candidate is the whole point: a message with a digit in it is one the sweep wants, and
 * the scan stops as soon as it has a batch of those. The dangerous history is the one where almost
 * nothing matches - the sweep then walks and walks looking for its batch, and that is the walk that has
 * to be bounded.
 */
function fakeEvent(id: string, inspected: { count: number }, body = "spotkanie 21.09 o 18:00"): any {
    return {
        getId: () => id,
        getRoomId: () => "!room:example.org",
        getTs: () => 1_700_000_000_000,
        getType: () => {
            // The first thing asked of any event it considers, so it is what "inspected" means.
            inspected.count++;
            return "m.room.message";
        },
        isRedacted: () => false,
        getContent: () => ({ body }),
        getSender: () => "@someone:example.org",
    };
}

function fakeClient(events: any[]): any {
    const room = {
        roomId: "!room:example.org",
        getLastLiveEvent: () => events[events.length - 1],
        getLiveTimeline: () => ({ getEvents: () => events }),
    };
    return {
        getSafeUserId: () => "@me:example.org",
        getVisibleRooms: () => [room],
        on: () => {},
        off: () => {},
    };
}

describe("the sweep over what is already loaded", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    it("inspects a bounded slice of a large history per turn, rather than all of it", () => {
        const inspected = { count: 0 };
        // Nothing here holds a digit, so the sweep finds no batch however far it walks - which is exactly
        // the history that used to be walked from end to end inside one idle callback.
        const events = Array.from({ length: 5000 }, (_, at) => fakeEvent(`$e${at}`, inspected, "nothing here"));
        const stop = startCollecting(fakeClient(events));

        // One turn: whatever this does, it must not be "look at five thousand messages".
        vi.advanceTimersByTime(600);
        stop();

        expect(inspected.count).toBeGreaterThan(0);
        expect(inspected.count).toBeLessThanOrEqual(SCANNED_PER_TURN);
    });

    it("does nothing at all when there is nothing loaded", () => {
        const stop = startCollecting(fakeClient([]));
        expect(() => vi.advanceTimersByTime(600)).not.toThrow();
        stop();
    });
});
