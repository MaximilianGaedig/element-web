/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "test-utils-rtl";
import { type MatrixClient, MsgType, TypedEventEmitter } from "matrix-js-sdk/src/matrix";
import { clearAllModals, mkStubRoom, mockPlatformPeg, stubClient } from "test-utils";

import MessageComposer from "./MessageComposer";
import MatrixClientContext from "../../../contexts/MatrixClientContext";
import ResizeNotifier from "../../../utils/ResizeNotifier";
import { RoomPermalinkCreator } from "../../../utils/permalinks/Permalinks";
import { ScopedRoomContextProvider } from "../../../contexts/ScopedRoomContext.tsx";
import { TimelineRenderingType, type RoomContextType } from "../../../contexts/RoomContext.ts";
import { RoomUploadContextProvider } from "../../../viewmodels/room/RoomUploadViewModel.tsx";
import { SDKContext } from "../../../contexts/SDKContext.ts";
import { SDKContextClass } from "../../../contexts/SDKContextClass.ts";
import { VoiceRecordingStore } from "../../../stores/VoiceRecordingStore";
import { UPDATE_EVENT } from "../../../stores/AsyncStore";
import { RecordingState } from "../../../audio/VoiceRecording";
import { type VoiceMessageRecording } from "../../../audio/VoiceMessageRecording";
import MediaDeviceHandler, { MediaDeviceKindEnum } from "../../../MediaDeviceHandler";
import { CANCEL_AT, LOCK_AT } from "../../../utils/telegram/voiceHold";

// The Telegram-style composer: the one whose microphone is held.
vi.mock("../../../utils/telegram/telegramLayout", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../utils/telegram/telegramLayout")>()),
    floatingBarsEnabled: () => true,
}));

/** A recording that records nothing, and is as long as the test says. */
class FakeRecording extends TypedEventEmitter<RecordingState, Record<RecordingState, () => void>> {
    public isRecording = false;
    public hasRecording = false;
    public durationSeconds = 3;
    public contentType = "audio/ogg";
    public contentLength = 1234;
    public liveData = { onUpdate: vi.fn() };
    public start = vi.fn(async (): Promise<void> => {
        this.isRecording = true;
        this.hasRecording = true;
        this.emit(RecordingState.Started);
    });
    public stop = vi.fn(async (): Promise<void> => {
        if (!this.isRecording) return;
        this.isRecording = false;
        this.emit(RecordingState.Ended);
    });
    public destroy = vi.fn();
    public upload = vi.fn(async () => ({ mxc: "mxc://example.com/voice" }));
    public getPlayback = (): object => ({
        on: vi.fn(),
        off: vi.fn(),
        prepare: vi.fn().mockResolvedValue(undefined),
        clockInfo: { timeSeconds: 0, liveData: { onUpdate: vi.fn() } },
        waveform: [1.4, 2.5, 3.6],
        waveformData: { onUpdate: vi.fn() },
        thumbnailWaveform: [1.4, 2.5, 3.6],
    });
}

describe("MessageComposer, holding the microphone", () => {
    let client: MatrixClient;
    let recording: FakeRecording | undefined;
    let made: FakeRecording | undefined;

    beforeEach(() => {
        client = stubClient();
        mockPlatformPeg();
        localStorage.clear();
        recording = undefined;
        made = undefined;

        const store = VoiceRecordingStore.instance;
        vi.spyOn(store, "getActiveRecording").mockImplementation(
            () => recording as unknown as VoiceMessageRecording | undefined,
        );
        vi.spyOn(store, "startRecording").mockImplementation(() => {
            recording = made = new FakeRecording();
            store.emit(UPDATE_EVENT);
            return recording as unknown as VoiceMessageRecording;
        });
        vi.spyOn(store, "disposeRecording").mockImplementation(async () => {
            recording?.destroy();
            recording = undefined;
            store.emit(UPDATE_EVENT);
        });
        vi.spyOn(MediaDeviceHandler, "getDevices").mockResolvedValue({
            [MediaDeviceKindEnum.AudioInput]: [{ deviceId: "mic" } as MediaDeviceInfo],
            [MediaDeviceKindEnum.AudioOutput]: [],
            [MediaDeviceKindEnum.VideoInput]: [],
        });
    });

    afterEach(async () => {
        await clearAllModals();
        vi.restoreAllMocks();
    });

    const open = (): { composer: HTMLElement; mic: HTMLElement } => {
        const room = mkStubRoom("!room:example.com", "Room", client);
        const roomContext = {
            room,
            canSendMessages: true,
            narrow: false,
            timelineRenderingType: TimelineRenderingType.Room,
        } satisfies Partial<RoomContextType> as RoomContextType;
        const { container } = render(
            <SDKContext.Provider value={SDKContextClass.instance}>
                <MatrixClientContext.Provider value={client}>
                    <ScopedRoomContextProvider {...roomContext}>
                        <RoomUploadContextProvider>
                            <MessageComposer
                                room={room}
                                resizeNotifier={new ResizeNotifier()}
                                permalinkCreator={new RoomPermalinkCreator(room)}
                            />
                        </RoomUploadContextProvider>
                    </ScopedRoomContextProvider>
                </MatrixClientContext.Provider>
            </SDKContext.Provider>,
        );
        return {
            composer: container.querySelector<HTMLElement>(".mx_MessageComposer")!,
            mic: screen.getByTestId("tgrecordbtn"),
        };
    };

    const START = { x: 300, y: 600 };
    const finger = (dx = 0, dy = 0): object => ({
        pointerId: 1,
        pointerType: "touch",
        isPrimary: true,
        clientX: START.x + dx,
        clientY: START.y + dy,
    });

    /** Finger down on the microphone, and kept there until the recording has started. */
    const hold = async (): Promise<{ composer: HTMLElement; mic: HTMLElement }> => {
        const opened = open();
        fireEvent.pointerDown(opened.mic, finger());
        await waitFor(() => expect(opened.composer).toHaveClass("mx_MessageComposer_tgHolding"));
        await waitFor(() => expect(made?.isRecording).toBe(true));
        // The recording's own row is up before the finger does anything else
        await waitFor(() =>
            expect(opened.composer.querySelector(".mx_VoiceRecordComposerTile_recording")).toBeTruthy(),
        );
        return opened;
    };

    const sentVoiceMessages = (): unknown[] =>
        vi
            .mocked(client.sendMessage)
            .mock.calls.map((call) => call[call.length - 1])
            .filter((content) => (content as { msgtype?: string }).msgtype === MsgType.Audio);

    it("records nothing on a tap, and says to hold", async () => {
        const { composer, mic } = open();

        fireEvent.pointerDown(mic, finger());
        fireEvent.pointerUp(mic, finger());

        expect(await screen.findByText("Hold to record a voice message")).toBeInTheDocument();
        expect(VoiceRecordingStore.instance.startRecording).not.toHaveBeenCalled();
        expect(composer).not.toHaveClass("mx_MessageComposer_tgHolding");
    });

    it("records while the microphone is held, with the microphone kept under the finger", async () => {
        const { composer, mic } = await hold();

        expect(screen.getByText("Slide to cancel")).toBeInTheDocument();
        // A recording puts the send button in the row and hides the microphone - not while it is held
        expect(mic.closest(".mx_TgComposerIsland_mic")).not.toHaveClass("mx_TgComposerIsland_hidden");
        expect(composer.querySelector(".mx_TgSendButton_send")).toBeNull();
        expect(sentVoiceMessages()).toHaveLength(0);
    });

    it("sends the recording when the finger lets go", async () => {
        const { composer, mic } = await hold();

        fireEvent.pointerUp(mic, finger());

        await waitFor(() => expect(sentVoiceMessages()).toHaveLength(1));
        await waitFor(() => expect(recording).toBeUndefined());
        expect(composer).not.toHaveClass("mx_MessageComposer_tgHolding");
        expect(screen.queryByText("Slide to cancel")).toBeNull();
    });

    it("throws the recording away when the finger slides left", async () => {
        const { composer, mic } = await hold();

        fireEvent.pointerMove(mic, finger(-(CANCEL_AT + 10), 0));

        await waitFor(() => expect(made!.destroy).toHaveBeenCalled());
        await waitFor(() => expect(composer).not.toHaveClass("mx_MessageComposer_tgHolding"));
        expect(recording).toBeUndefined();
        expect(sentVoiceMessages()).toHaveLength(0);
        // and letting go afterwards sends nothing either
        fireEvent.pointerUp(mic, finger(-(CANCEL_AT + 10), 0));
        await act(async () => {});
        expect(sentVoiceMessages()).toHaveLength(0);
    });

    /** Held, then slid up far enough to lock, and the finger taken away. */
    const lock = async (): Promise<{ composer: HTMLElement; mic: HTMLElement }> => {
        const opened = await hold();
        fireEvent.pointerMove(opened.mic, finger(0, -(LOCK_AT + 10)));
        await waitFor(() => expect(opened.composer).toHaveClass("mx_MessageComposer_tgRecording"));
        return opened;
    };
    /** The stop button ignores the touch that locked the recording; this is a later one. */
    const later = (): void => {
        vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10_000);
    };

    it("keeps the same recording row once it has slid up to lock, with the finger gone", async () => {
        const { composer } = await lock();

        expect(composer).not.toHaveClass("mx_MessageComposer_tgHolding");
        expect(made!.isRecording).toBe(true);
        expect(made!.destroy).not.toHaveBeenCalled();
        expect(sentVoiceMessages()).toHaveLength(0);
        // the row is still the recording, now with Cancel beside it instead of "Slide to cancel"
        expect(composer.querySelector(".mx_VoiceRecordComposerTile_recording")).toBeTruthy();
        expect(screen.queryByText("Slide to cancel")).toBeNull();
        expect(screen.getByTestId("tgcancelrecording")).toHaveTextContent("Cancel");
        // and it is sent from where the microphone was, with stopping above it
        const island = composer.querySelector(".mx_TgComposerIsland_mic")!;
        expect(island).not.toHaveClass("mx_TgComposerIsland_hidden");
        expect(island).toContainElement(screen.getByTestId("sendmessagebtn"));
        expect(island).toContainElement(screen.getByTestId("tgstoprecording"));
        expect(screen.queryByTestId("tgrecordbtn")).toBeNull();
        expect(composer.querySelectorAll("[data-testid='sendmessagebtn']")).toHaveLength(1);
    });

    it("sends a locked recording from the send button", async () => {
        await lock();

        fireEvent.click(screen.getByTestId("sendmessagebtn"));

        await waitFor(() => expect(sentVoiceMessages()).toHaveLength(1));
        await waitFor(() => expect(screen.getByTestId("tgrecordbtn")).toBeInTheDocument());
    });

    it("throws a locked recording away from Cancel", async () => {
        const { composer } = await lock();

        fireEvent.click(screen.getByTestId("tgcancelrecording"));

        await waitFor(() => expect(made!.destroy).toHaveBeenCalled());
        await waitFor(() => expect(screen.getByTestId("tgrecordbtn")).toBeInTheDocument());
        expect(composer).not.toHaveClass("mx_MessageComposer_tgRecording");
        expect(sentVoiceMessages()).toHaveLength(0);
    });

    it("does not stop the recording with the touch that locked it", async () => {
        await lock();

        fireEvent.click(screen.getByTestId("tgstoprecording"));
        await act(async () => {});

        expect(made!.isRecording).toBe(true);
    });

    it("stops a locked recording to be heard, deleted or sent", async () => {
        const { composer } = await lock();
        later();

        fireEvent.click(screen.getByTestId("tgstoprecording"));

        await waitFor(() => expect(made!.isRecording).toBe(false));
        await waitFor(() => expect(composer).not.toHaveClass("mx_MessageComposer_tgRecording"));
        expect(made!.destroy).not.toHaveBeenCalled();
        expect(screen.queryByTestId("tgstoprecording")).toBeNull();
        expect(screen.queryByTestId("tgcancelrecording")).toBeNull();
        expect(composer.querySelector(".mx_VoiceRecordComposerTile_delete")).toBeTruthy();
        expect(composer.querySelector(".mx_TgComposerIsland_mic")).toContainElement(
            screen.getByTestId("sendmessagebtn"),
        );
    });

    it("gives a recording started with a click the same row", async () => {
        const { composer, mic } = open();

        fireEvent.click(mic);

        await waitFor(() => expect(composer).toHaveClass("mx_MessageComposer_tgRecording"));
        expect(made!.isRecording).toBe(true);
        expect(screen.getByTestId("tgcancelrecording")).toBeInTheDocument();
        expect(screen.getByTestId("tgstoprecording")).toBeInTheDocument();
    });

    it("throws away a recording too short to be meant", async () => {
        const { mic } = await hold();
        made!.durationSeconds = 0.2;

        fireEvent.pointerUp(mic, finger());

        await waitFor(() => expect(made!.destroy).toHaveBeenCalled());
        expect(sentVoiceMessages()).toHaveLength(0);
        expect(await screen.findByText("Hold to record a voice message")).toBeInTheDocument();
    });

    it("holds nothing when there is no microphone", async () => {
        vi.mocked(MediaDeviceHandler.getDevices).mockResolvedValue({
            [MediaDeviceKindEnum.AudioInput]: [],
            [MediaDeviceKindEnum.AudioOutput]: [],
            [MediaDeviceKindEnum.VideoInput]: [],
        });
        const { composer, mic } = open();

        fireEvent.pointerDown(mic, finger());
        await waitFor(() => expect(screen.getByText("No microphone found")).toBeInTheDocument());
        fireEvent.pointerUp(mic, finger());

        await waitFor(() => expect(composer).not.toHaveClass("mx_MessageComposer_tgHolding"));
        expect(VoiceRecordingStore.instance.startRecording).not.toHaveBeenCalled();
        expect(sentVoiceMessages()).toHaveLength(0);
    });
});
