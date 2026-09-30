/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";

import { videoEmbedUrl } from "./webPageEmbed";

const player = (id: string, extra = ""): string => `https://www.youtube-nocookie.com/embed/${id}?autoplay=1${extra}`;

describe("videoEmbedUrl", () => {
    it("finds YouTube's player for each form of its links", () => {
        for (const link of [
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://youtube.com/watch?v=dQw4w9WgXcQ&list=PL1",
            "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://youtu.be/dQw4w9WgXcQ",
            "https://www.youtube.com/shorts/dQw4w9WgXcQ",
            "https://www.youtube.com/live/dQw4w9WgXcQ",
            "https://www.youtube.com/embed/dQw4w9WgXcQ",
        ]) {
            expect(videoEmbedUrl(link)).toBe(player("dQw4w9WgXcQ"));
        }
    });

    it("starts where the link says to", () => {
        expect(videoEmbedUrl("https://youtu.be/dQw4w9WgXcQ?t=90")).toBe(player("dQw4w9WgXcQ", "&start=90"));
        expect(videoEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s")).toBe(
            player("dQw4w9WgXcQ", "&start=90"),
        );
    });

    it("finds Vimeo's player", () => {
        expect(videoEmbedUrl("https://vimeo.com/76979871")).toBe("https://player.vimeo.com/video/76979871?autoplay=1");
    });

    it("frames nothing else", () => {
        expect(videoEmbedUrl("https://www.youtube.com/")).toBeUndefined();
        expect(videoEmbedUrl("https://www.youtube.com/@channel")).toBeUndefined();
        expect(videoEmbedUrl("https://www.youtube.com/watch?v=<script>")).toBeUndefined();
        expect(videoEmbedUrl("https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ")).toBeUndefined();
        expect(videoEmbedUrl("https://example.org/watch?v=dQw4w9WgXcQ")).toBeUndefined();
        expect(videoEmbedUrl("javascript:alert(1)")).toBeUndefined();
        expect(videoEmbedUrl("not a url")).toBeUndefined();
    });
});
