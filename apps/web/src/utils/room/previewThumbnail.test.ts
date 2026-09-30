/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";
import { stubClient } from "test-utils";

import { previewThumbnail } from "./previewThumbnail";

stubClient();

const message = (content: Record<string, unknown>, id = "$m"): MatrixEvent =>
    new MatrixEvent({ type: "m.room.message", event_id: id, room_id: "!r:e", sender: "@a:e", content });

const roomWith = (...events: MatrixEvent[]): Room =>
    ({ findEventById: (id: string) => events.find((e) => e.getId() === id) }) as unknown as Room;

const photo = message({ msgtype: "m.image", body: "photo.jpg", url: "mxc://e/photo" }, "$photo");

describe("previewThumbnail", () => {
    it("shows the last message's own photo", () => {
        expect(previewThumbnail(photo, roomWith())).toContain("photo");
    });

    it("shows a video's poster frame, and nothing for a video without one", () => {
        const withPoster = message({
            msgtype: "m.video",
            body: "v",
            url: "mxc://e/video",
            info: { thumbnail_url: "mxc://e/poster" },
        });
        const without = message({ msgtype: "m.video", body: "v", url: "mxc://e/video" });
        expect(previewThumbnail(withPoster, roomWith())).toContain("poster");
        expect(previewThumbnail(without, roomWith())).toBeUndefined();
    });

    /* "nice!" under somebody's photo is about the photo. */
    it("shows the photo a reply is to, when that photo is loaded", () => {
        const reply = message({
            "msgtype": "m.text",
            "body": "nice!",
            "m.relates_to": { "m.in_reply_to": { event_id: "$photo" } },
        });
        expect(previewThumbnail(reply, roomWith(photo))).toContain("photo");
        expect(previewThumbnail(reply, roomWith())).toBeUndefined();
    });

    it("shows nothing for encrypted media, which has no URL until it is decrypted", () => {
        const encrypted = message({
            msgtype: "m.image",
            body: "p",
            file: { url: "mxc://e/enc", key: {}, iv: "", hashes: {}, v: "v2" },
        });
        expect(previewThumbnail(encrypted, roomWith())).toBeUndefined();
    });

    it("shows nothing for text", () => {
        expect(previewThumbnail(message({ msgtype: "m.text", body: "hi" }), roomWith())).toBeUndefined();
        expect(previewThumbnail(undefined, roomWith())).toBeUndefined();
    });
});
