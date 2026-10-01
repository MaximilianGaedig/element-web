/*
 * Copyright 2025 New Vector Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

// @vitest-environment happy-dom

import { EventType, MatrixEvent, Room } from "matrix-js-sdk/src/matrix";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "test-utils-rtl";
import React from "react";

import { createTestClient, stubClient } from "test-utils";
import { MockedPlayback } from "../../../audio/__mocks__";
import { type Playback, PlaybackState } from "../../../audio/Playback";
import { PlaybackManager } from "../../../audio/PlaybackManager";
import type { MediaEventHelper } from "../../../utils/MediaEventHelper";
import MVoiceMessageBody from "./MVoiceMessageBody";
import { PlaybackQueue } from "../../../audio/PlaybackQueue";
import { SDKContextClass } from "../../../contexts/SDKContextClass";

// A stored transcript is looked up for every voice message with an ID; there is none here.
vi.mock("../../../utils/detect/mediaText", () => ({ storedMediaText: vi.fn().mockResolvedValue(undefined) }));

describe("<MVvoiceMessageBody />", () => {
    let event: MatrixEvent;
    beforeEach(() => {
        const playback = new MockedPlayback(PlaybackState.Decoding, 50, 10) as unknown as Playback;
        vi.spyOn(PlaybackManager.instance, "createPlaybackInstance").mockReturnValue(playback);

        const matrixClient = createTestClient();
        const room = new Room("!TESTROOM", matrixClient, "@alice:example.org");
        const playbackQueue = new PlaybackQueue(room, SDKContextClass.instance.roomViewStore);

        vi.spyOn(PlaybackQueue, "forRoom").mockReturnValue(playbackQueue);
        vi.spyOn(playbackQueue, "unsortedEnqueue").mockReturnValue(undefined);

        event = new MatrixEvent({
            room_id: "!room:server",
            sender: "@alice.example.org",
            type: EventType.RoomMessage,
            content: {
                "body": "audio name ",
                "msgtype": "m.audio",
                "url": "mxc://server/audio",
                "org.matrix.msc3946.voice": true,
            },
        });
    });

    it("should render", async () => {
        const mediaEventHelper = {
            sourceBlob: {
                value: {
                    arrayBuffer: () => new ArrayBuffer(8),
                },
            },
        } as unknown as MediaEventHelper;

        await act(() => render(<MVoiceMessageBody mxEvent={event} mediaEventHelper={mediaEventHelper} />));
        expect(await screen.findByTestId("recording-playback")).toBeInTheDocument();
    });

    it("leaves nothing in the room's queue once its tiles are gone", async () => {
        // Scrolling through a chat mounts and unmounts a tile per voice message. The queue is kept for
        // the session, so whatever it still holds afterwards is held until the page is closed - and a
        // playback holds the decoded audio.
        const matrixClient = stubClient();
        const room = new Room("!QUEUE", matrixClient, "@alice:example.org");
        vi.mocked(matrixClient.getRoom).mockReturnValue(room);
        vi.mocked(PlaybackQueue.forRoom).mockRestore();
        const queue = PlaybackQueue.forRoom(room.roomId, SDKContextClass.instance.roomViewStore);
        vi.spyOn(PlaybackManager.instance, "createPlaybackInstance").mockImplementation(
            () => new MockedPlayback(PlaybackState.Decoding, 50, 10) as unknown as Playback,
        );
        const mediaEventHelper = {
            sourceBlob: { value: { arrayBuffer: () => new ArrayBuffer(8) } },
        } as unknown as MediaEventHelper;

        for (let i = 0; i < 50; i++) {
            const voiceMessage = new MatrixEvent({
                event_id: `$voice${i}`,
                room_id: room.roomId,
                sender: "@alice.example.org",
                type: EventType.RoomMessage,
                content: { "body": "voice", "msgtype": "m.audio", "url": "mxc://s/a", "org.matrix.msc3245.voice": {} },
            });
            const { unmount } = await act(() =>
                render(<MVoiceMessageBody mxEvent={voiceMessage} mediaEventHelper={mediaEventHelper} />),
            );
            expect(await screen.findByTestId("recording-playback")).toBeInTheDocument();
            expect(queue.playbackCount).toBe(1);
            unmount();
        }

        expect(queue.playbackCount).toBe(0);
    });
});
