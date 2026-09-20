/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { beforeEach, describe, expect, it, vi, type MockedObject } from "vitest";
import { fireEvent, render, screen } from "test-utils-rtl";
import { flushPromises, mkMembership, mkMessage, stubClient } from "test-utils";
import { type MatrixClient, MatrixEvent, Room } from "matrix-js-sdk/src/matrix";

import MatrixClientContext from "../../../contexts/MatrixClientContext";
import { SharedMediaPane } from "./SharedMediaPanel";
import { SharedMediaLoader } from "../../../utils/sharedMedia";
import { fetchRoomStats, type RoomStats } from "../../../utils/chatHistory";

vi.mock("../../../utils/chatHistory", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../utils/chatHistory")>()),
    fetchRoomStats: vi.fn(),
}));

const roomId = "!room:example.org";

function image(id: string, body: string): MatrixEvent {
    return new MatrixEvent({
        type: "m.room.message",
        event_id: id,
        room_id: roomId,
        sender: "@alice:example.org",
        origin_server_ts: 1000,
        content: { msgtype: "m.image", body, url: "mxc://example.org/i" },
    });
}

function audio(id: string, body: string): MatrixEvent {
    return new MatrixEvent({
        type: "m.room.message",
        event_id: id,
        room_id: roomId,
        sender: "@alice:example.org",
        origin_server_ts: 1000,
        content: {
            msgtype: "m.audio",
            body: body,
            url: "mxc://example.org/a",
            info: { mimetype: "audio/mpeg", duration: 125000 },
        },
    });
}

describe("<SharedMediaPane />", () => {
    let client!: MockedObject<MatrixClient>;
    let room!: Room;

    beforeEach(() => {
        client = stubClient() as MockedObject<MatrixClient>;
        room = new Room(roomId, client, client.getSafeUserId());
        room.currentState.setStateEvents([
            mkMembership({ event: true, room: roomId, user: "@alice:example.org", name: "Alice", mship: "join" }),
        ]);
        client.getRoom.mockReturnValue(room);
        vi.mocked(fetchRoomStats).mockResolvedValue({
            total: 20,
            by_kind: { text: 5, image: 45, video: 6, audio: 2, voice: 9, file: 3 },
            senders: [],
            sender_count: 1,
            complete: true,
        } as RoomStats);
    });

    function renderTab(tab: "media" | "music" | "links", events: MatrixEvent[]) {
        room.addLiveEvents(events, { addToState: true });
        const loader = new SharedMediaLoader(client, room);
        return render(
            <MatrixClientContext.Provider value={client}>
                <SharedMediaPane loader={loader} tab={tab} />
            </MatrixClientContext.Provider>,
        );
    }

    it("counts the whole room from the server's numbers, not what happens to be loaded", async () => {
        renderTab("media", []);
        await flushPromises();
        expect(screen.getByText("45 photos, 6 videos")).toBeInTheDocument();
    });

    it("does not build an audio player for every track: one is built when it is played", async () => {
        renderTab("music", [audio("$a", "song.mp3"), audio("$b", "other.mp3")]);
        await flushPromises();
        expect(screen.getByText("2 tracks")).toBeInTheDocument();
        expect(screen.getByText("song.mp3")).toBeInTheDocument();
        expect(screen.getAllByText("2:05")).toHaveLength(2);
        expect(document.querySelector(".mx_MAudioBody")).not.toBeInTheDocument();
    });

    it("selects media and offers what to do with the selection", async () => {
        renderTab("media", [image("$i1", "a.jpg"), image("$i2", "b.jpg")]);
        await flushPromises();
        const items = document.querySelectorAll<HTMLElement>(".mx_SharedMedia_gridItem");
        expect(items).toHaveLength(2);
        // Ctrl-click starts a selection without going through the tab's menu.
        fireEvent.click(items[0], { ctrlKey: true });
        expect(screen.getByText("1 selected")).toBeInTheDocument();
        fireEvent.click(items[1]);
        expect(screen.getByText("2 selected")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Forward" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Download" })).toBeInTheDocument();
        // One message at a time can be shown where it was sent.
        expect(screen.queryByRole("button", { name: "Show in chat" })).not.toBeInTheDocument();
    });

    it("names the sender of a link instead of showing their user ID", async () => {
        const link = mkMessage({
            event: true,
            room: roomId,
            user: "@alice:example.org",
            msg: "look at https://example.org/x",
        });
        renderTab("links", [link]);
        await flushPromises();
        expect(screen.getByText("Alice")).toBeInTheDocument();
        expect(screen.queryByText("@alice:example.org")).not.toBeInTheDocument();
    });
});
