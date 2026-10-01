/*
 * Copyright 2025 New Vector Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

// @vitest-environment happy-dom

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventType, MatrixEvent } from "matrix-js-sdk/src/matrix";
import { render, screen, act } from "test-utils-rtl";

import { MockedPlayback } from "../../../audio/__mocks__";
import { type Playback, PlaybackState } from "../../../audio/Playback";
import MAudioBody from "./MAudioBody";
import { PlaybackManager } from "../../../audio/PlaybackManager";
import { type MediaEventHelper } from "../../../utils/MediaEventHelper";

describe("<MAudioBody />", () => {
    let event: MatrixEvent;

    const mediaEventHelper = {
        sourceBlob: {
            value: {
                arrayBuffer: () => new ArrayBuffer(8),
            },
        },
    } as unknown as MediaEventHelper;

    beforeEach(() => {
        const playback = new MockedPlayback(PlaybackState.Decoding, 50, 10) as unknown as Playback;
        vi.spyOn(PlaybackManager.instance, "createPlaybackInstance").mockReturnValue(playback);

        event = new MatrixEvent({
            room_id: "!room:server",
            sender: "@alice.example.org",
            type: EventType.RoomMessage,
            content: {
                body: "audio name ",
                msgtype: "m.audio",
                url: "mxc://server/audio",
            },
        });
    });

    it("should render", async () => {
        await act(() => render(<MAudioBody mxEvent={event} mediaEventHelper={mediaEventHelper} />));
        expect(await screen.findByRole("region", { name: "Audio player" })).toBeInTheDocument();
    });

    it("should show the body as the title when there is no filename", async () => {
        await act(() => render(<MAudioBody mxEvent={event} mediaEventHelper={mediaEventHelper} />));
        expect(await screen.findByRole("region", { name: "Audio player" })).toBeInTheDocument();
        expect(screen.getByText("audio name")).toBeInTheDocument();
    });

    it("should prefer the filename over the body as the title", async () => {
        // A caption puts the human readable text in `body` and the actual file name in `filename`.
        event.getContent().filename = "recording.ogg";
        event.getContent().body = "Listen to this!";

        await act(() => render(<MAudioBody mxEvent={event} mediaEventHelper={mediaEventHelper} />));
        expect(await screen.findByRole("region", { name: "Audio player" })).toBeInTheDocument();
        expect(screen.getByText("recording.ogg")).toBeInTheDocument();
        expect(screen.queryByText("Listen to this!")).not.toBeInTheDocument();
    });

    it("makes no playback for a tile that was gone before its audio arrived", async () => {
        // Scrolled past while still downloading: nothing is left to destroy a playback made now, so it
        // would stay in the manager (and its audio in memory) for the rest of the session.
        const download = Promise.withResolvers<{ arrayBuffer: () => ArrayBuffer }>();
        const slowHelper = { sourceBlob: { value: download.promise } } as unknown as MediaEventHelper;
        const create = vi.mocked(PlaybackManager.instance.createPlaybackInstance);
        create.mockClear();

        const { unmount } = render(<MAudioBody mxEvent={event} mediaEventHelper={slowHelper} />);
        unmount();
        await act(async () => {
            download.resolve({ arrayBuffer: () => new ArrayBuffer(8) });
            await download.promise;
        });

        expect(create).not.toHaveBeenCalled();
    });
});
