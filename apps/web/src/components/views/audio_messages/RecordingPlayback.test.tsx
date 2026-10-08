/*
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import React from "react";
import { logger } from "matrix-js-sdk/src/logger";
import { fireEvent, render, type RenderResult } from "test-utils-rtl";
import { flushPromises } from "test-utils";

import RecordingPlayback, { PlaybackLayout } from "./RecordingPlayback";
import { Playback } from "../../../audio/Playback";
import { type RoomContextType, TimelineRenderingType } from "../../../contexts/RoomContext";
import { createAudioContext } from "../../../audio/compat";
import { ScopedRoomContextProvider } from "../../../contexts/ScopedRoomContext.tsx";
import { PlaybackSpeed } from "../../../audio/PlaybackSpeed";

vi.mock("../../../WorkerManager", () => ({
    WorkerManager: vi.fn(function () {
        return {
            call: vi.fn().mockResolvedValue({ waveform: [0, 0, 1, 1] }),
        };
    }),
}));

vi.mock("../../../audio/compat", () => ({
    createAudioContext: vi.fn(),
    decodeOgg: vi.fn().mockResolvedValue({}),
}));

describe("<RecordingPlayback />", () => {
    const mockAudioContext = {
        decodeAudioData: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
    };

    const mockAudioBuffer = {
        duration: 99,
        getChannelData: vi.fn(),
    };

    const mockChannelData = new Float32Array();

    const defaultRoom = {
        roomId: "!room:server.org",
        timelineRenderingType: TimelineRenderingType.File,
    } as RoomContextType;
    const getComponent = (props: React.ComponentProps<typeof RecordingPlayback>, room = defaultRoom) =>
        render(
            <ScopedRoomContextProvider {...room}>
                <RecordingPlayback {...props} />
            </ScopedRoomContextProvider>,
        );

    beforeEach(() => {
        vi.spyOn(logger, "error").mockRestore();
        mockAudioBuffer.getChannelData.mockClear().mockReturnValue(mockChannelData);
        mockAudioContext.decodeAudioData.mockReset().mockResolvedValue(mockAudioBuffer);
        vi.mocked(createAudioContext).mockReturnValue(mockAudioContext as unknown as AudioContext);

        // A voice message plays through an <audio /> element, which this environment cannot load: a
        // stand-in that is ready as soon as it is given something to play.
        const createElement = document.createElement.bind(document);
        vi.spyOn(document, "createElement").mockImplementation((tag: string, options?: ElementCreationOptions) => {
            if (tag.toUpperCase() !== "AUDIO") return createElement(tag, options);
            const element = {
                duration: 99,
                currentTime: 0,
                play: vi.fn().mockResolvedValue(undefined),
                pause: vi.fn(),
                load: vi.fn(),
                remove: vi.fn(),
                removeAttribute: vi.fn(),
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                onloadeddata: undefined as undefined | null | (() => void),
                onerror: undefined as undefined | null | (() => void),
            };
            Object.defineProperty(element, "src", {
                set() {
                    element.onloadeddata?.();
                },
                get: () => "blob:audio",
            });
            return element as unknown as HTMLElement;
        });
        global.URL.createObjectURL = vi.fn().mockReturnValue("blob:audio");
        global.URL.revokeObjectURL = vi.fn();
        localStorage.clear();
    });

    afterEach(() => {
        vi.mocked(document.createElement).mockRestore();
    });

    const getPlayButton = (component: RenderResult) => component.getByTestId("play-pause-button");

    it("renders recording playback", () => {
        const playback = new Playback(new ArrayBuffer(8));
        const component = getComponent({ playback });
        expect(component).toBeTruthy();
    });

    it("disables play button while playback is decoding", async () => {
        const playback = new Playback(new ArrayBuffer(8));
        const component = getComponent({ playback });
        expect(getPlayButton(component)).toHaveAttribute("aria-disabled", "true");
    });

    it("enables play button when playback is finished decoding", async () => {
        const playback = new Playback(new ArrayBuffer(8));
        const component = getComponent({ playback });
        await flushPromises();
        expect(getPlayButton(component)).not.toHaveAttribute("aria-disabled", "true");
    });

    it("displays error when playback decoding fails", async () => {
        // stub logger to keep console clean from expected error
        vi.spyOn(logger, "error").mockReturnValue(undefined);
        vi.spyOn(logger, "warn").mockReturnValue(undefined);
        mockAudioContext.decodeAudioData.mockImplementation((_b, _cb, error) => error(new Error("oh no")));
        const playback = new Playback(new ArrayBuffer(8));
        const component = getComponent({ playback });
        await flushPromises();
        expect(component.container.querySelector(".text-warning")).toBeDefined();
    });

    it("displays pre-prepared playback with correct playback phase", async () => {
        const playback = new Playback(new ArrayBuffer(8));
        await playback.prepare();
        const component = getComponent({ playback });
        // playback already decoded, button is not disabled
        expect(getPlayButton(component)).not.toHaveAttribute("aria-disabled", "true");
        expect(component.container.querySelector(".text-warning")).toBeFalsy();
    });

    it("toggles playback on play pause button click", async () => {
        const playback = new Playback(new ArrayBuffer(8));
        vi.spyOn(playback, "toggle").mockResolvedValue(undefined);
        await playback.prepare();
        const component = getComponent({ playback });

        fireEvent.click(getPlayButton(component));

        expect(playback.toggle).toHaveBeenCalled();
    });

    describe("Composer Layout", () => {
        it("should have a waveform, no seek bar, and clock", () => {
            const playback = new Playback(new ArrayBuffer(8));
            const component = getComponent({ playback, layout: PlaybackLayout.Composer });

            expect(component.container.querySelector(".mx_Clock")).toBeDefined();
            expect(component.container.querySelector(".mx_Waveform")).toBeDefined();
            expect(component.container.querySelector(".mx_SeekBar")).toBeFalsy();
        });
    });

    describe("voice message extras", () => {
        it("has no dot and no speed button unless asked", () => {
            const component = getComponent({ playback: new Playback(new ArrayBuffer(8)) });

            expect(component.container.querySelector(".mx_RecordingPlayback_unplayed")).toBeFalsy();
            expect(component.queryByTestId("playback-speed")).toBeNull();
        });

        it("shows a dot beside the time of a message nobody has played", () => {
            const component = getComponent({ playback: new Playback(new ArrayBuffer(8)), unplayed: true });

            expect(component.getByRole("img", { name: "Not played yet" })).toBeInTheDocument();
        });

        it("moves on to the next speed when the speed button is pressed", () => {
            const component = getComponent({ playback: new Playback(new ArrayBuffer(8)), showSpeed: true });
            const button = component.getByTestId("playback-speed");
            expect(button).toHaveTextContent("1×");

            fireEvent.click(button);
            expect(button).toHaveTextContent("1.5×");
            expect(PlaybackSpeed.current).toBe(1.5);

            fireEvent.click(button);
            fireEvent.click(button);
            expect(button).toHaveTextContent("1×");
        });

        it("tells the layout which phase the playback is in, for the speed button to show by", async () => {
            const playback = new Playback(new ArrayBuffer(8));
            const component = getComponent({ playback, showSpeed: true });
            expect(component.getByTestId("recording-playback")).toHaveAttribute("data-playback-phase", "decoding");

            await flushPromises();
            expect(component.getByTestId("recording-playback")).toHaveAttribute("data-playback-phase", "stopped");
        });
    });

    describe("Timeline Layout", () => {
        it("should have a waveform, a seek bar, and clock", () => {
            const playback = new Playback(new ArrayBuffer(8));
            const component = getComponent({ playback, layout: PlaybackLayout.Timeline });

            expect(component.container.querySelector(".mx_Clock")).toBeDefined();
            expect(component.container.querySelector(".mx_Waveform")).toBeDefined();
            expect(component.container.querySelector(".mx_SeekBar")).toBeDefined();
        });

        it("should be the default", () => {
            const playback = new Playback(new ArrayBuffer(8));
            const component = getComponent({ playback }); // no layout set for test

            expect(component.container.querySelector(".mx_Clock")).toBeDefined();
            expect(component.container.querySelector(".mx_Waveform")).toBeDefined();
            expect(component.container.querySelector(".mx_SeekBar")).toBeDefined();
        });
    });
});
