/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, it, expect } from "vitest";
import { MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";

import { hasCodeBlock, roomHasCodeBlock } from "./codeHighlighter";

const message = (content: object): MatrixEvent =>
    new MatrixEvent({ type: "m.room.message", event_id: `$${Math.random()}`, content });
const roomWith = (events: MatrixEvent[]): Room =>
    ({ getLiveTimeline: () => ({ getEvents: () => events }) }) as unknown as Room;

describe("codeHighlighter", () => {
    it("knows a code block by its <pre>, or by a fence in plain text", () => {
        expect(
            hasCodeBlock(
                message({ body: "x", format: "org.matrix.custom.html", formatted_body: "<pre><code>x</code></pre>" }),
            ),
        ).toBe(true);
        expect(hasCodeBlock(message({ body: "```\nls\n```" }))).toBe(true);
        expect(hasCodeBlock(message({ body: "just `inline` code" }))).toBe(false);
        expect(hasCodeBlock(message({ body: "hello", formatted_body: "<b>hello</b>" }))).toBe(false);
    });

    // Most chats never show code: they need not load ~1 MB of highlighter.
    it("says a chat without code has none, and one with code has some", () => {
        expect(roomHasCodeBlock(roomWith([message({ body: "hi" }), message({ body: "how are you" })]))).toBe(false);
        expect(roomHasCodeBlock(roomWith([message({ body: "```js\n1\n```" }), message({ body: "hi" })]))).toBe(true);
    });

    it("looks only so far back", () => {
        const old = [message({ body: "```\nold\n```" }), ...Array.from({ length: 250 }, () => message({ body: "hi" }))];
        expect(roomHasCodeBlock(roomWith(old))).toBe(false);
    });
});
