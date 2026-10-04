/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MatrixEvent, Room } from "matrix-js-sdk/src/matrix";
import { act, fireEvent, render, screen } from "test-utils-rtl";
import { stubClient } from "test-utils";

import BulkActionsBar from "./BulkActionsBar";
import { MessageSelectionStore } from "../../../stores/MessageSelectionStore";
import * as strings from "../../../utils/strings";
import type { RoomPermalinkCreator } from "../../../utils/permalinks/Permalinks";

const ROOM = "!r:x";

function message(id: string, body: string, ts: number): MatrixEvent {
    return new MatrixEvent({
        type: "m.room.message",
        event_id: id,
        room_id: ROOM,
        sender: "@ada:x",
        origin_server_ts: ts,
        content: { msgtype: "m.text", body },
    });
}

describe("BulkActionsBar", () => {
    const client = stubClient();
    const room = new Room(ROOM, client, client.getSafeUserId());
    room.getUnfilteredTimelineSet().addLiveEvent(message("$a", "first", 1), { addToState: false });
    room.getUnfilteredTimelineSet().addLiveEvent(message("$b", "second", 2), { addToState: false });
    const renderBar = () => render(<BulkActionsBar room={room} permalinkCreator={{} as RoomPermalinkCreator} />);

    // Only the clipboard is mocked per test: restoring every mock would undo stubClient's logged-in client too.
    // Without ClipboardItem the bar copies through copyPlaintext, which is what these tests watch.
    vi.stubGlobal("ClipboardItem", undefined);
    const copy = vi.spyOn(strings, "copyPlaintext");
    afterEach(() => {
        act(() => MessageSelectionStore.instance.exitSelectionMode(ROOM));
        copy.mockReset();
    });

    /* There was no copy at all: only forward and remove. */
    it("copies the picked messages, and keeps them picked", async () => {
        copy.mockResolvedValue(true);
        MessageSelectionStore.instance.enterSelectionMode(ROOM, "$a");
        renderBar();

        fireEvent.click(screen.getByRole("button", { name: "Copy" }));

        expect(copy).toHaveBeenCalledWith("first");
        expect(await screen.findByRole("button", { name: "Copied!" })).toBeInTheDocument();
        expect(MessageSelectionStore.instance.isSelecting(ROOM)).toBe(true);
    });

    it("lets go of them all when the count is tapped", () => {
        MessageSelectionStore.instance.enterSelectionMode(ROOM, "$a");
        renderBar();

        fireEvent.click(screen.getByRole("button", { name: "1 message selected" }));

        expect(MessageSelectionStore.instance.isSelecting(ROOM)).toBe(false);
    });

    it("takes in every loaded message on Ctrl+A, copies them on Ctrl+C, and ends on Escape", () => {
        copy.mockResolvedValue(true);
        MessageSelectionStore.instance.enterSelectionMode(ROOM, "$a");
        renderBar();

        act(() => void fireEvent.keyDown(document.body, { key: "a", ctrlKey: true }));
        expect(MessageSelectionStore.instance.getSelectedIds(ROOM).sort()).toEqual(["$a", "$b"]);

        act(() => void fireEvent.keyDown(document.body, { key: "c", ctrlKey: true }));
        expect(copy).toHaveBeenCalledWith(expect.stringMatching(/first\n.*second$/));

        act(() => void fireEvent.keyDown(document.body, { key: "Escape" }));
        expect(MessageSelectionStore.instance.isSelecting(ROOM)).toBe(false);
    });
});
