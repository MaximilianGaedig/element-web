/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, it, expect } from "vitest";
import { type IContent } from "matrix-js-sdk/src/matrix";

import { buildBridgeButtonsFallback, stripBridgeButtonsFallback, TELEGRAM_BUTTONS_FIELD } from "./BridgeButtons";

// What mautrix-telegram sends with `inline_button_fallback: true` (see inlinebuttons.go fallbackText()).
const keyboard = {
    message_id: 4242,
    keyboard: "inline",
    rows: [
        [
            { text: "✅ Yes", type: "callback", command: "!tg click 4242 0 0" },
            { text: "No  <thanks>", type: "callback", command: "!tg click 4242 0 1" },
        ],
        [{ text: "Open site", type: "url", url: "https://example.com/?a=1&b=2" }],
        [{ text: "Copy", type: "copy", copy_text: "abc" }],
    ],
};
const plainFallback =
    "Buttons:\n✅ Yes (!tg click 4242 0 0) | No <thanks> (!tg click 4242 0 1)\nOpen site (https://example.com/?a=1&b=2)\nCopy";
const htmlFallback =
    "<p>Buttons:<br>✅ Yes (<code>!tg click 4242 0 0</code>) | No &lt;thanks&gt; (<code>!tg click 4242 0 1</code>)" +
    '<br><a href="https://example.com/?a=1&amp;b=2">Open site</a><br>Copy</p>';

function mkContent(extra: IContent = {}): IContent {
    return {
        msgtype: "m.text",
        body: "Do you like <b>it</b>?\n\n" + plainFallback,
        format: "org.matrix.custom.html",
        formatted_body: "Do you like &lt;b&gt;it&lt;/b&gt;?" + htmlFallback,
        [TELEGRAM_BUTTONS_FIELD]: keyboard,
        ...extra,
    };
}

describe("stripBridgeButtonsFallback", () => {
    it("rebuilds the bridge's fallback exactly", () => {
        expect(buildBridgeButtonsFallback(mkContent())).toEqual({ plain: plainFallback, html: htmlFallback });
    });

    it("strips the fallback from body and formatted_body", () => {
        const stripped = stripBridgeButtonsFallback(mkContent());
        expect(stripped.body).toBe("Do you like <b>it</b>?");
        expect(stripped.formatted_body).toBe("Do you like &lt;b&gt;it&lt;/b&gt;?");
        expect(stripped[TELEGRAM_BUTTONS_FIELD]).toBe(keyboard);
    });

    it("strips a fallback-only caption (media without caption) to empty", () => {
        const stripped = stripBridgeButtonsFallback(
            mkContent({ msgtype: "m.image", body: plainFallback, formatted_body: htmlFallback, filename: "a.jpg" }),
        );
        expect(stripped.body).toBe("");
        expect(stripped.formatted_body).toBe("");
    });

    it("falls back to a structural match when labels differ from the keyboard", () => {
        const stripped = stripBridgeButtonsFallback(
            mkContent({
                body: "Hi\n\nButtons:\nA (!tg click 1 0 0) | B\nC (https://x)\nD",
                formatted_body: "<p>Hi</p><p>Buttons:<br/>A | B<br />C<br>D</p>",
            }),
        );
        expect(stripped.body).toBe("Hi");
        expect(stripped.formatted_body).toBe("<p>Hi</p>");
    });

    it("leaves text that merely mentions Buttons: alone", () => {
        const content = mkContent({
            body: "Buttons: are great\n\nsee",
            formatted_body: "<p>Buttons: are great</p><p>see</p>",
        });
        expect(stripBridgeButtonsFallback(content)).toBe(content);
    });

    it("does not strip when the buttons aren't rendered (no/reply/invalid keyboard)", () => {
        const none = mkContent({ [TELEGRAM_BUTTONS_FIELD]: undefined });
        expect(stripBridgeButtonsFallback(none)).toBe(none);
        const reply = mkContent({ [TELEGRAM_BUTTONS_FIELD]: { ...keyboard, keyboard: "reply" } });
        expect(stripBridgeButtonsFallback(reply)).toBe(reply);
        const empty = mkContent({ [TELEGRAM_BUTTONS_FIELD]: { keyboard: "inline", rows: [] } });
        expect(stripBridgeButtonsFallback(empty)).toBe(empty);
    });

    it("handles plain-text-only content", () => {
        const content = mkContent({ format: undefined, formatted_body: undefined });
        const stripped = stripBridgeButtonsFallback(content);
        expect(stripped.body).toBe("Do you like <b>it</b>?");
        expect(stripped.formatted_body).toBeUndefined();
    });
});
