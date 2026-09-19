/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { render, screen } from "test-utils-rtl";
import { describe, it, expect, vi } from "vitest";
import { mkEvent, stubClient, withClientContextRenderOptions } from "test-utils";

import ReplyPreview from "./ReplyPreview";
import SettingsStore from "../../../settings/SettingsStore";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";

describe("ReplyPreview (Telegram layout)", () => {
    it("is tweb's reply row: 'Reply to <name>', the message, a cancel button", async () => {
        const realGetValue = SettingsStore.getValue.bind(SettingsStore);
        vi.spyOn(SettingsStore, "getValue").mockImplementation(((name: string, ...rest: unknown[]) =>
            name === "telegramStyleLayout"
                ? true
                : (realGetValue as any)(name, ...rest)) as typeof SettingsStore.getValue);
        const cli = stubClient();
        const { room_id: roomId } = await cli.createRoom({});
        const ev = mkEvent({
            event: true,
            type: "m.room.message",
            user: "@alice:example.org",
            room: roomId,
            id: "$quoted",
            content: { body: "See you there", msgtype: "m.text" },
        });
        const dispatch = vi.spyOn(dis, "dispatch");

        const { container } = render(<ReplyPreview replyToEvent={ev} />, withClientContextRenderOptions(cli));

        const row = container.querySelector(".mx_TgReplyRow");
        expect(row).not.toBeNull();
        expect(row!.className).toMatch(/mx_Username_color\d/);
        expect(container.querySelector(".mx_TgReplyQuote_title")?.textContent).toMatch(/^Reply to \S/);
        expect(container.querySelector(".mx_TgReplyQuote_subtitle")?.textContent).toBe("See you there");

        screen.getByRole("button", { name: "Cancel" }).click();
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ action: "reply_to_event", event: null }));

        container.querySelector<HTMLElement>(".mx_TgReplyQuote_composer")!.click();
        expect(dispatch).toHaveBeenCalledWith(
            expect.objectContaining({ action: Action.ViewRoom, event_id: "$quoted", highlighted: true }),
        );
    });
});
