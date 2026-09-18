/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type MatrixEvent } from "matrix-js-sdk/src/matrix";

import { mkEvent } from "../../test-utils";
import {
    canJoinGroup,
    getAlbumGridLayout,
    getAlbumInfo,
    getCaptionEvents,
    getGroupKey,
    getMediaSize,
    NATIVE_GROUP_WINDOW_MS,
    sortAlbumItems,
} from "../../../src/utils/MediaAlbum";
import { layoutAlbum } from "../../../src/utils/GroupedMediaLayout";
import { SETTINGS } from "../../../src/settings/Settings";

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
        info?: Record<string, unknown>;
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
            ...(opts.info ? { info: opts.info } : {}),
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

    it("defaults the non-Telegram 'group consecutive images' heuristic to off", () => {
        expect(SETTINGS["groupConsecutiveImages"].default).toBe(false);
    });

    it("sorts Telegram-style items (index = msgID offset, no count) by index", () => {
        const items = [7, 0, 3].map((index) => mkMedia(`$${index}`, { album: { id: "tg:-123", index } }));
        expect(sortAlbumItems(items).map((e) => e.getId())).toEqual(["$0", "$3", "$7"]);
    });

    describe("getMediaSize", () => {
        it("uses info.w/h, then the thumbnail's, then a square", () => {
            expect(getMediaSize(mkMedia("$1", { info: { w: 1600, h: 900 } }))).toEqual({ w: 1600, h: 900 });
            expect(getMediaSize(mkMedia("$2", { info: { thumbnail_info: { w: 320, h: 240 } } }))).toEqual({
                w: 320,
                h: 240,
            });
            expect(getMediaSize(mkMedia("$3", { info: { w: 0, h: 10 } }))).toEqual({ w: 1, h: 1 });
            expect(getMediaSize(mkMedia("$4"))).toEqual({ w: 1, h: 1 });
        });
    });

    describe("getAlbumGridLayout", () => {
        it("lays several items out with Telegram's layouter", () => {
            const items = [mkMedia("$1", { info: { w: 900, h: 1600 } }), mkMedia("$2", { info: { w: 1000, h: 1000 } })];
            expect(getAlbumGridLayout(items)).toEqual(
                layoutAlbum([
                    { w: 900, h: 1600 },
                    { w: 1000, h: 1000 },
                ]),
            );
        });

        it("fits a lone visual item into a 420px box", () => {
            const tall = getAlbumGridLayout([mkMedia("$1", { info: { w: 500, h: 1000 } })]);
            expect([tall.width, tall.height]).toEqual([210, 420]);
            const wide = getAlbumGridLayout([mkMedia("$2", { info: { w: 2000, h: 1000 } })]);
            expect([wide.width, wide.height]).toEqual([420, 210]);
        });
    });
});
