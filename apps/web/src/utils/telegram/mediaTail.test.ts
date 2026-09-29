/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { MatrixEvent } from "matrix-js-sdk/src/matrix";

import { mediaTailStyle } from "./mediaTail";

let hasThumbnail = true;
/** Every (width, height, mode, authenticated) the tail asked a rendition for. */
const asked: Array<[number, number, string, boolean | undefined]> = [];
vi.mock("../../customisations/Media", () => ({
    // The renditions the bodies themselves read, so the tail cannot end up with a different image.
    mediaFromContent: () => ({
        get hasThumbnail() {
            return hasThumbnail;
        },
        getThumbnailHttp: (w: number, h: number, mode: string, authenticated?: boolean) => {
            asked.push([w, h, mode, authenticated]);
            return hasThumbnail ? "https://example.org/thumb.jpg" : null;
        },
        getThumbnailOfSourceHttp: (w: number, h: number, mode: string, authenticated?: boolean) => {
            asked.push([w, h, mode, authenticated]);
            return "https://example.org/source.jpg";
        },
    }),
}));

beforeEach(() => {
    hasThumbnail = true;
    asked.length = 0;
});

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
    it("hands down the picture the bubble is showing, not a crop of the original", () => {
        const style = mediaTailStyle(message({ msgtype: "m.image", body: "a", url: "mxc://x/a" })) as Record<
            string,
            string
        >;
        expect(style["--tg-media-tail"]).toBe('url("https://example.org/thumb.jpg")');
        // Scaled, not cropped: a square crop would not continue the corner the tail grows from.
        expect(asked[0][2]).toBe("scale");
    });

    it("asks for a URL the browser can fetch itself, since a stylesheet carries no token", () => {
        mediaTailStyle(message({ msgtype: "m.image", body: "a", url: "mxc://x/a" }));
        // The authenticated endpoint would refuse a background image; the worker authenticates the
        // legacy one instead.
        expect(asked.map(([, , , authenticated]) => authenticated)).toEqual([false]);
    });

    it("does the same for a video, which shows as its frame", () => {
        const style = mediaTailStyle(message({ msgtype: "m.video", body: "a", url: "mxc://x/a" })) as Record<
            string,
            string
        >;
        expect(style["--tg-media-tail"]).toBe('url("https://example.org/thumb.jpg")');
    });

    it("falls back to the picture itself where the server made no thumbnail", () => {
        hasThumbnail = false;
        const style = mediaTailStyle(message({ msgtype: "m.image", body: "a", url: "mxc://x/a" })) as Record<
            string,
            string
        >;
        expect(style["--tg-media-tail"]).toBe('url("https://example.org/source.jpg")');
    });

    it("says nothing for a video with no frame to show, rather than the video file itself", () => {
        hasThumbnail = false;
        expect(mediaTailStyle(message({ msgtype: "m.video", body: "a", url: "mxc://x/a" }))).toBeUndefined();
    });

    it("hands down the size the bubble draws it at, so the tail holds a sliver and not the whole of it", () => {
        const style = mediaTailStyle(
            message({ msgtype: "m.image", body: "a", url: "mxc://x/a", info: { w: 1920, h: 1080 } }),
        ) as Record<string, string>;
        // Whatever the layout's box works out to, the tail is told it in pixels rather than being
        // left to scale the whole picture into its own 11x20 - and is handed the rendition to match.
        expect(style["--tg-media-tail-size"]).toMatch(/^\d+px \d+px$/);
        expect(style["--tg-media-tail-size"]).toBe(`${asked[0][0]}px ${asked[0][1]}px`);
    });

    it("leaves encrypted media alone: its URL does not exist until it is decrypted", () => {
        expect(mediaTailStyle(message({ msgtype: "m.image", body: "a", file: { url: "mxc://x/a" } }))).toBeUndefined();
    });

    it("has nothing to say about a message that is not a picture", () => {
        expect(mediaTailStyle(message({ msgtype: "m.text", body: "hello" }))).toBeUndefined();
        expect(mediaTailStyle(message({ msgtype: "m.file", body: "a.pdf", url: "mxc://x/a" }))).toBeUndefined();
    });
});
