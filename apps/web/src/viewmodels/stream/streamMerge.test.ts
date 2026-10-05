/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";

import { mergeStream, roomsToPaginate, streamBound, type StreamSource } from "./streamMerge";

function source(roomId: string, times: number[], opts: Partial<StreamSource> = {}): StreamSource {
    return {
        roomId,
        events: times.map((ts) => ({ eventId: `${roomId}-${ts}`, ts, sender: "@a:x" })),
        oldestLoadedTs: times[0],
        canPaginateBack: true,
        ...opts,
    };
}

describe("streamBound", () => {
    it("is the newest of the oldest loaded messages among rooms with more to load", () => {
        expect(streamBound([source("a", [10, 50]), source("b", [30, 40]), source("c", [5])])).toBe(30);
    });

    it("leaves out rooms loaded to their start, and rooms with nothing loaded", () => {
        const complete = source("a", [100, 200], { canPaginateBack: false });
        const empty = source("b", [], { oldestLoadedTs: undefined });
        expect(streamBound([complete, empty, source("c", [20])])).toBe(20);
        expect(streamBound([complete, empty])).toBe(-Infinity);
    });
});

describe("mergeStream", () => {
    it("merges rooms by time and drops what is older than the bound", () => {
        const merged = mergeStream([source("a", [10, 31, 50]), source("b", [30, 40])], 30);
        expect(merged.map((e) => e.eventId)).toEqual(["b-30", "a-31", "b-40", "a-50"]);
    });

    it("keeps a room's own order where its timestamps disagree with it", () => {
        // Bridged history can carry send times out of order; the room's order is the one it was said in.
        const merged = mergeStream([source("a", [10, 30, 20]), source("b", [25])], -Infinity);
        expect(merged.map((e) => e.eventId)).toEqual(["a-10", "b-25", "a-30", "a-20"]);
    });

    it("puts equal times in source order, so rebuilding does not shuffle them", () => {
        const merged = mergeStream([source("a", [10]), source("b", [10])], -Infinity);
        expect(merged.map((e) => e.roomId)).toEqual(["a", "b"]);
    });
});

describe("roomsToPaginate", () => {
    it("picks the rooms holding the bound first, at most the number asked for", () => {
        const sources = [
            source("a", [10]),
            source("b", [40]),
            source("c", [30]),
            source("d", [50], { canPaginateBack: false }),
        ];
        expect(roomsToPaginate(sources, 2)).toEqual(["b", "c"]);
    });
});
