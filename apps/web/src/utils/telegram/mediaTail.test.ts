/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it, vi } from "vitest";
import { MatrixEvent } from "matrix-js-sdk/src/matrix";

import { mediaTailStyle } from "./mediaTail";

const asked: Array<boolean | undefined> = [];
vi.mock("../../customisations/Media", () => ({
    mediaFromContent: () => ({
        hasThumbnail: true,
        getThumbnailHttp: (_w: number, _h: number, _mode: string, authenticated?: boolean) => {
            asked.push(authenticated);
            return "https://example.org/thumb.jpg";
        },
        getThumbnailOfSourceHttp: () => "https://example.org/source.jpg",
    }),
}));

function message(content: Record<string, unknown>): MatrixEvent {
    return new MatrixEvent({
        type: "m.room.message",
        event_id: "$e",
        room_id: "!r:x",
        sender: "@a:x",
        origin_server_ts: 1,
        content,
    });
}

describe("mediaTailStyle", () => {
    it("hands the picture down for the tail to be filled with", () => {
        expect(mediaTailStyle(message({ msgtype: "m.image", body: "a", url: "mxc://x/a" }))).toEqual({
            "--tg-media-tail": 'url("https://example.org/thumb.jpg")',
        });
    });

    it("asks for a URL the browser can fetch itself, since a stylesheet carries no token", () => {
        asked.length = 0;
        mediaTailStyle(message({ msgtype: "m.image", body: "a", url: "mxc://x/a" }));
        // The authenticated endpoint would refuse a background image; the worker authenticates the
        // legacy one instead.
        expect(asked).toEqual([false]);
    });

    it("does the same for a video, which shows as its frame", () => {
        expect(mediaTailStyle(message({ msgtype: "m.video", body: "a", url: "mxc://x/a" }))).toBeDefined();
    });

    it("leaves encrypted media alone: its URL does not exist until it is decrypted", () => {
        expect(mediaTailStyle(message({ msgtype: "m.image", body: "a", file: { url: "mxc://x/a" } }))).toBeUndefined();
    });

    it("has nothing to say about a message that is not a picture", () => {
        expect(mediaTailStyle(message({ msgtype: "m.text", body: "hello" }))).toBeUndefined();
        expect(mediaTailStyle(message({ msgtype: "m.file", body: "a.pdf", url: "mxc://x/a" }))).toBeUndefined();
    });
});
