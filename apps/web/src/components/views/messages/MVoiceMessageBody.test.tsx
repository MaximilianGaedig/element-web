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
import { PlaybackSpeed } from "../../../audio/PlaybackSpeed";
import { ListenedVoiceMessages } from "../../../audio/ListenedVoiceMessages";
import * as mediaSession from "../../../audio/PlaybackMediaSession";

// A stored transcript is looked up for every voice message with an ID; there is none here.
vi.mock("../../../utils/detect/mediaText", () => ({ storedMediaText: vi.fn().mockResolvedValue(undefined) }));

describe("<MVvoiceMessageBody />", () => {
    let event: MatrixEvent;
    let playback: MockedPlayback;
    beforeEach(() => {
        localStorage.clear();
        ListenedVoiceMessages.reset();
        playback = new MockedPlayback(PlaybackState.Decoding, 50, 10);
        vi.spyOn(PlaybackManager.instance, "createPlaybackInstance").mockReturnValue(playback as unknown as Playback);

        stubClient(); // the transcript under the player looks up what the server already knows
        const matrixClient = createTestClient();
        const room = new Room("!TESTROOM", matrixClient, "@alice:example.org");
        const playbackQueue = new PlaybackQueue(room, SDKContextClass.instance.roomViewStore);

        vi.spyOn(PlaybackQueue, "forRoom").mockReturnValue(playbackQueue);
        vi.spyOn(playbackQueue, "unsortedEnqueue").mockReturnValue(undefined);

        event = new MatrixEvent({
            event_id: "$voice",
            room_id: "!room:server",
            sender: "@alice.example.org",
            origin_server_ts: Date.now() + 1000,
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

    const mediaEventHelper = {
        sourceBlob: { value: { arrayBuffer: () => new ArrayBuffer(8) } },
    } as unknown as MediaEventHelper;

    it("plays at the speed chosen for every voice message, and follows a change", async () => {
        PlaybackSpeed.set(1.5);
        await act(() => render(<MVoiceMessageBody mxEvent={event} mediaEventHelper={mediaEventHelper} />));
        await screen.findByTestId("recording-playback");
        expect(playback.playbackRate).toBe(1.5);

        act(() => PlaybackSpeed.set(2));

        expect(playback.playbackRate).toBe(2);
    });

    it("stops following the speed once its tile is gone", async () => {
        const { unmount } = await act(() =>
            render(<MVoiceMessageBody mxEvent={event} mediaEventHelper={mediaEventHelper} />),
        );
        await screen.findByTestId("recording-playback");
        unmount();

        PlaybackSpeed.set(2);

        expect(playback.playbackRate).toBe(1);
    });

    it("shows a dot until the message is played, then not again", async () => {
        // Somebody else's message that arrived after unplayed messages began to count.
        localStorage.setItem("mx_voice_message_listened_since", "1");
        await act(() => render(<MVoiceMessageBody mxEvent={event} mediaEventHelper={mediaEventHelper} />));
        await screen.findByTestId("recording-playback");
        expect(screen.getByRole("img", { name: "Not played yet" })).toBeInTheDocument();

        act(() => playback.setState(PlaybackState.Playing));

        expect(screen.queryByRole("img", { name: "Not played yet" })).toBeNull();
        expect(ListenedVoiceMessages.isUnplayed(event, "@me:example.org")).toBe(false);
    });

    it("puts the message on the system's media controls, and takes it off when its tile is gone", async () => {
        const detach = vi.fn();
        const attach = vi.spyOn(mediaSession, "attachMediaSession").mockReturnValue(detach);

        const { unmount } = await act(() =>
            render(<MVoiceMessageBody mxEvent={event} mediaEventHelper={mediaEventHelper} />),
        );
        await screen.findByTestId("recording-playback");
        expect(attach).toHaveBeenCalledWith(
            playback,
            expect.stringContaining("Voice message from"),
            expect.any(String),
        );

        unmount();
        expect(detach).toHaveBeenCalled();
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
