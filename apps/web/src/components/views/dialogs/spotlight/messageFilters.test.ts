/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";

import { kindOf, matchesMessageFilter, NO_MESSAGE_FILTER, isFiltering } from "./messageFilters";
import { snippetParts as parts } from "./messageSnippet";

const snippetParts = (body: string, highlights: string[]) =>
    parts(body, highlights).map(({ text, match }) => ({ text, match }));

const NOW = Date.UTC(2026, 9, 4, 12);
const DAY = 24 * 60 * 60 * 1000;
const msg = (content: Record<string, any>, over: { ts?: number; isDirect?: boolean } = {}) => ({
    content,
    ts: over.ts ?? NOW - 1000,
    isDirect: over.isDirect ?? false,
});

describe("kindOf", () => {
    it.each([
        [{ msgtype: "m.image", body: "a.png" }, "media"],
        [{ msgtype: "m.video", body: "a.mp4" }, "media"],
        [{ msgtype: "m.file", body: "a.pdf" }, "files"],
        [{ msgtype: "m.audio", body: "song.mp3" }, "music"],
        [{ "msgtype": "m.audio", "body": "voice", "org.matrix.msc3245.voice": {} }, "voice"],
        [{ msgtype: "m.text", body: "see https://example.com/x" }, "links"],
        [{ msgtype: "m.text", body: "see www.example.com" }, "links"],
        [{ msgtype: "m.text", body: "hello" }, undefined],
    ])("files %j as %s", (content, kind) => {
        expect(kindOf(content)).toBe(kind);
    });
});

describe("matchesMessageFilter", () => {
    it("lets everything through with no filter", () => {
        expect(isFiltering(NO_MESSAGE_FILTER)).toBe(false);
        expect(matchesMessageFilter(msg({ body: "x" }), NO_MESSAGE_FILTER, NOW)).toBe(true);
    });

    it("narrows by where the message was said", () => {
        const direct = msg({ body: "x" }, { isDirect: true });
        const group = msg({ body: "x" });
        expect(matchesMessageFilter(direct, { ...NO_MESSAGE_FILTER, chat: "direct" }, NOW)).toBe(true);
        expect(matchesMessageFilter(group, { ...NO_MESSAGE_FILTER, chat: "direct" }, NOW)).toBe(false);
        expect(matchesMessageFilter(group, { ...NO_MESSAGE_FILTER, chat: "group" }, NOW)).toBe(true);
        expect(matchesMessageFilter(direct, { ...NO_MESSAGE_FILTER, chat: "group" }, NOW)).toBe(false);
    });

    it("narrows by how long ago", () => {
        const old = msg({ body: "x" }, { ts: NOW - 3 * DAY });
        expect(matchesMessageFilter(old, { ...NO_MESSAGE_FILTER, when: "day" }, NOW)).toBe(false);
        expect(matchesMessageFilter(old, { ...NO_MESSAGE_FILTER, when: "week" }, NOW)).toBe(true);
        expect(
            matchesMessageFilter(
                msg({ body: "x" }, { ts: NOW - 40 * DAY }),
                { ...NO_MESSAGE_FILTER, when: "month" },
                NOW,
            ),
        ).toBe(false);
    });

    it("narrows by kind, and counts a link in a caption as a link", () => {
        const photo = msg({ msgtype: "m.image", body: "a.png" });
        const captioned = msg({ msgtype: "m.image", body: "look https://example.com" });
        expect(matchesMessageFilter(photo, { ...NO_MESSAGE_FILTER, kind: "media" }, NOW)).toBe(true);
        expect(matchesMessageFilter(photo, { ...NO_MESSAGE_FILTER, kind: "links" }, NOW)).toBe(false);
        expect(matchesMessageFilter(captioned, { ...NO_MESSAGE_FILTER, kind: "links" }, NOW)).toBe(true);
    });
});

describe("snippetParts", () => {
    it("marks what matched, whatever its case", () => {
        expect(snippetParts("Dinner at Eight", ["eight"])).toEqual([
            { text: "Dinner at ", match: false },
            { text: "Eight", match: true },
        ]);
    });

    it("prefers the longer term where two overlap", () => {
        const parts = snippetParts("abc", ["a", "abc"]);
        expect(parts).toEqual([{ text: "abc", match: true }]);
    });

    it("starts a long message shortly before the first match", () => {
        const body = `${"filler ".repeat(30)}needle ${"after ".repeat(40)}`;
        const parts = snippetParts(body, ["needle"]);
        expect(parts[0]).toEqual({ text: "…", match: false });
        expect(parts.find((p) => p.match)?.text).toBe("needle");
        expect(parts.map((p) => p.text).join("").length).toBeLessThan(160);
    });

    it("does not choke on characters that mean something in a pattern", () => {
        expect(snippetParts("is 1+1=2?", ["1+1"])).toContainEqual({ text: "1+1", match: true });
    });
});
