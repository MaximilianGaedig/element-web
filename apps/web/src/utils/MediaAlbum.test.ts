/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect } from "vitest";
import { type MatrixEvent } from "matrix-js-sdk/src/matrix";

import { mkEvent } from "test-utils";
import {
    buildAlbumSlots,
    canJoinGroup,
    getAlbumInfo,
    getAlbumLayout,
    getCaptionEvents,
    getDeclaredCount,
    getGroupKey,
    NATIVE_GROUP_WINDOW_MS,
    PLACEHOLDER_GRACE_MS,
    sortAlbumItems,
} from "./MediaAlbum";

const ROOM = "!room:example.org";
const ALICE = "@alice:example.org";
const BOB = "@bob:example.org";

function mkMedia(
    id: string,
    opts: {
        sender?: string;
        ts?: number;
        msgtype?: string;
        album?: Record<string, unknown>;
        body?: string;
        filename?: string;
    } = {},
): MatrixEvent {
    return mkEvent({
        event: true,
        type: "m.room.message",
        room: ROOM,
        user: opts.sender ?? ALICE,
        id,
        ts: opts.ts ?? 1000,
        content: {
            msgtype: opts.msgtype ?? "m.image",
            body: opts.body ?? "photo.jpg",
            ...(opts.filename ? { filename: opts.filename } : {}),
            url: `mxc://example.org/${id.slice(1)}`,
            ...(opts.album ? { "fi.mau.album": opts.album } : {}),
        },
    });
}

describe("MediaAlbum utils", () => {
    describe("getAlbumInfo", () => {
        it("parses the marker", () => {
            expect(getAlbumInfo(mkMedia("$a", { album: { id: "x", index: 2, count: 3 } }))).toEqual({
                id: "x",
                index: 2,
                count: 3,
            });
        });

        it("tolerates a missing count and ignores malformed fields", () => {
            expect(getAlbumInfo(mkMedia("$a", { album: { id: "x", index: 0 } }))).toEqual({ id: "x", index: 0 });
            expect(getAlbumInfo(mkMedia("$a", { album: { id: "x", index: -1, count: "3" } }))).toEqual({ id: "x" });
            expect(getAlbumInfo(mkMedia("$a", { album: { id: 5 } }))).toBeNull();
            expect(getAlbumInfo(mkMedia("$a", { album: { id: "x" }, msgtype: "m.text" }))).toBeNull();
        });
    });

    describe("getGroupKey / canJoinGroup", () => {
        it("groups album items by sender and album id", () => {
            const first = mkMedia("$1", { album: { id: "a" } });
            const key = getGroupKey(first, true)!;
            expect(key).toEqual({ kind: "album", sender: ALICE, albumId: "a" });
            expect(canJoinGroup(key, first, mkMedia("$2", { album: { id: "a" } }), true)).toBe(true);
            expect(canJoinGroup(key, first, mkMedia("$3", { album: { id: "b" } }), true)).toBe(false);
            expect(canJoinGroup(key, first, mkMedia("$4", { album: { id: "a" }, sender: BOB }), true)).toBe(false);
            // an un-marked image never joins a bridged album
            expect(canJoinGroup(key, first, mkMedia("$5"), true)).toBe(false);
        });

        it("groups native media within the time window only when the setting is on", () => {
            const first = mkMedia("$1", { ts: 0 });
            expect(getGroupKey(first, false)).toBeNull();
            const key = getGroupKey(first, true)!;
            expect(key.kind).toBe("native");
            expect(
                canJoinGroup(key, first, mkMedia("$2", { ts: NATIVE_GROUP_WINDOW_MS, msgtype: "m.video" }), true),
            ).toBe(true);
            expect(canJoinGroup(key, first, mkMedia("$3", { ts: NATIVE_GROUP_WINDOW_MS + 1 }), true)).toBe(false);
            expect(canJoinGroup(key, first, mkMedia("$4", { msgtype: "m.file" }), true)).toBe(false);
            expect(canJoinGroup(key, first, mkMedia("$5", { album: { id: "a" } }), true)).toBe(false);
        });
    });

    it("sorts by index, keeping index-less items last in timeline order", () => {
        const a = mkMedia("$a", { album: { id: "x", index: 2 } });
        const b = mkMedia("$b", { album: { id: "x" } });
        const c = mkMedia("$c", { album: { id: "x", index: 0 } });
        const d = mkMedia("$d", { album: { id: "x", index: 1 } });
        expect(sortAlbumItems([a, b, c, d]).map((e) => e.getId())).toEqual(["$c", "$d", "$a", "$b"]);
    });

    it("finds captions (body differing from filename), de-duplicated", () => {
        const plain = mkMedia("$1", { body: "a.jpg", filename: "a.jpg" });
        const legacy = mkMedia("$2", { body: "b.jpg" });
        const captioned = mkMedia("$3", { body: "Holiday!", filename: "c.jpg" });
        const dup = mkMedia("$4", { body: "Holiday!", filename: "d.jpg" });
        expect(getCaptionEvents([plain, legacy, captioned, dup]).map((e) => e.getId())).toEqual(["$3"]);
    });

    describe("buildAlbumSlots", () => {
        const now = 10_000;

        it("reserves placeholder slots for declared items and places items at their index", () => {
            const items = [
                mkMedia("$0", { album: { id: "x", index: 0, count: 4 }, ts: now }),
                mkMedia("$2", { album: { id: "x", index: 2, count: 4 }, ts: now }),
            ];
            expect(getDeclaredCount(items)).toBe(4);
            const slots = buildAlbumSlots(items, 4, now);
            expect(slots.map((s) => ("event" in s ? s.event.getId() : "ph"))).toEqual(["$0", "ph", "$2", "ph"]);
        });

        it("drops placeholders once the grace period is over", () => {
            const items = [mkMedia("$0", { ts: 0 }), mkMedia("$1", { ts: 0 })];
            expect(buildAlbumSlots(items, 4, PLACEHOLDER_GRACE_MS + 1)).toHaveLength(2);
        });

        it("falls back to sequential placement for duplicate indices", () => {
            const items = [
                mkMedia("$a", { album: { id: "x", index: 1, count: 3 }, ts: now }),
                mkMedia("$b", { album: { id: "x", index: 1, count: 3 }, ts: now }),
            ];
            const slots = buildAlbumSlots(items, 3, now);
            expect(slots.map((s) => ("event" in s ? s.event.getId() : "ph"))).toEqual(["$a", "$b", "ph"]);
        });
    });

    it.each([
        [2, { visible: 2, overflow: 0, variant: "n2" }],
        [3, { visible: 3, overflow: 0, variant: "n3" }],
        [4, { visible: 4, overflow: 0, variant: "n4" }],
        [5, { visible: 5, overflow: 0, variant: "n5" }],
        [6, { visible: 6, overflow: 0, variant: "n6" }],
        [9, { visible: 6, overflow: 3, variant: "n6" }],
    ])("lays out %i items", (n, expected) => {
        expect(getAlbumLayout(n)).toEqual(expected);
    });
});
