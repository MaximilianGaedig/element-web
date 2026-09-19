/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from "vitest";
import { MatrixEvent } from "matrix-js-sdk/src/matrix";

import shouldHideEvent from "../../../shouldHideEvent";
import { stubClient } from "test-utils";

const ROOM_ID = "!portal:example.org";

describe("Bridge timeline hiding", () => {
    beforeEach(() => stubClient());

    it("hides state changes marked com.beeper.exclude_from_timeline", () => {
        const mk = (extra: Record<string, unknown>): MatrixEvent =>
            new MatrixEvent({
                type: "m.room.name",
                state_key: "",
                room_id: ROOM_ID,
                sender: "@bot:example.org",
                event_id: "$name",
                content: { name: "Alice", ...extra },
            });
        expect(shouldHideEvent(mk({ "com.beeper.exclude_from_timeline": true, "fi.mau.implicit_name": true }))).toBe(
            true,
        );
        expect(shouldHideEvent(mk({}))).toBe(false);
    });

    it("hides redacted messages whose redaction asks for no placeholder", () => {
        const mk = (redactionContent: Record<string, unknown>): MatrixEvent =>
            new MatrixEvent({
                type: "m.room.message",
                room_id: ROOM_ID,
                sender: "@signal_1:example.org",
                event_id: "$msg",
                content: {},
                unsigned: {
                    redacted_because: {
                        type: "m.room.redaction",
                        room_id: ROOM_ID,
                        sender: "@signal_1:example.org",
                        event_id: "$redaction",
                        redacts: "$msg",
                        origin_server_ts: 1,
                        content: redactionContent,
                        unsigned: {},
                    },
                },
            });
        // showRedactions is on by default, so a normal redaction keeps its placeholder.
        expect(shouldHideEvent(mk({}))).toBe(false);
        expect(shouldHideEvent(mk({ "com.beeper.dont_render_redacted_placeholder": true }))).toBe(true);
    });
});
