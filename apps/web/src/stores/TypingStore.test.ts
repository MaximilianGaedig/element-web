/*
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { type MatrixClient, Method } from "matrix-js-sdk/src/matrix";
import { TestSDKContext } from "test-utils";

import TypingStore, { holdSelfTypingActivity } from "./TypingStore";
import { LOCAL_ROOM_ID_PREFIX } from "../models/LocalRoom";
import SettingsStore from "../settings/SettingsStore";

vi.mock("../settings/SettingsStore", () => ({
    default: {
        getValue: vi.fn(),
        monitorSetting: vi.fn(),
        watchSetting: vi.fn(),
    },
}));

describe("TypingStore", () => {
    let typingStore: TypingStore;
    let mockClient: MatrixClient;
    const roomId = "!test:example.com";
    const localRoomId = LOCAL_ROOM_ID_PREFIX + "test";

    beforeEach(() => {
        mockClient = {
            sendTyping: vi.fn(),
            getUserId: vi.fn().mockReturnValue("@me:example.com"),
            isGuest: vi.fn().mockReturnValue(false),
            doesServerSupportUnstableFeature: vi.fn().mockResolvedValue(true),
            http: { authedRequest: vi.fn().mockResolvedValue({}) },
        } as unknown as MatrixClient;
        const context = new TestSDKContext();
        context._client = mockClient;
        typingStore = new TypingStore(context);
        vi.spyOn(SettingsStore, "getValue").mockImplementation((name: string) => {
            return name === "sendTypingNotifications";
        });
    });

    describe("setSelfTyping", () => {
        it("shouldn't do anything for a local room", () => {
            typingStore.setSelfTyping(localRoomId, null, true);
            expect(mockClient.sendTyping).not.toHaveBeenCalled();
        });

        describe("in typing state true", () => {
            beforeEach(() => {
                typingStore.setSelfTyping(roomId, null, true);
            });

            it("should change to false when setting false", () => {
                typingStore.setSelfTyping(roomId, null, false);
                expect(mockClient.sendTyping).toHaveBeenCalledWith(roomId, false, 30000);
            });

            it("should change to true when setting true", () => {
                typingStore.setSelfTyping(roomId, null, true);
                expect(mockClient.sendTyping).toHaveBeenCalledWith(roomId, true, 30000);
            });
        });

        describe("in typing state false", () => {
            beforeEach(() => {
                typingStore.setSelfTyping(roomId, null, false);
            });

            it("shouldn't change when setting false", () => {
                typingStore.setSelfTyping(roomId, null, false);
                expect(mockClient.sendTyping).not.toHaveBeenCalled();
            });

            it("should change to true when setting true", () => {
                typingStore.setSelfTyping(roomId, null, true);
                expect(mockClient.sendTyping).toHaveBeenCalledWith(roomId, true, 30000);
            });
        });
    });

    describe("holdSelfActivity", () => {
        const path = "/rooms/!test%3Aexample.com/typing/%40me%3Aexample.com";
        const activity = (kind: string): unknown[] => [
            Method.Put,
            path,
            undefined,
            { "typing": true, "timeout": 30000, "im.mxg.typing.kind": kind },
        ];

        // Lets the store hear back from the server; the timers are fake, so nothing else moves.
        const flushPromises = (): Promise<unknown> => vi.advanceTimersByTimeAsync(0);

        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it("asks the server for the feature it needs", async () => {
            typingStore.holdSelfActivity(roomId, null, "recording_voice");
            await flushPromises();
            expect(mockClient.doesServerSupportUnstableFeature).toHaveBeenCalledWith("im.mxg.typing_kinds");
        });

        it("tells the room what the user is doing, and that they stopped", async () => {
            const stop = typingStore.holdSelfActivity(roomId, null, "recording_voice");
            await flushPromises();
            expect(mockClient.http.authedRequest).toHaveBeenCalledExactlyOnceWith(...activity("recording_voice"));
            expect(mockClient.sendTyping).not.toHaveBeenCalled();

            stop();
            await flushPromises();
            expect(mockClient.sendTyping).toHaveBeenCalledExactlyOnceWith(roomId, false, 30000);
            expect(mockClient.http.authedRequest).toHaveBeenCalledTimes(1);
        });

        it("keeps telling for as long as it lasts, and no longer", async () => {
            const stop = typingStore.holdSelfActivity(roomId, null, "uploading_file");
            await flushPromises();
            // Longer than the server keeps a typing notification.
            await vi.advanceTimersByTimeAsync(65_000);
            expect(mockClient.http.authedRequest).toHaveBeenCalledTimes(4);
            expect(mockClient.http.authedRequest).toHaveBeenLastCalledWith(...activity("uploading_file"));

            stop();
            await flushPromises();
            await vi.advanceTimersByTimeAsync(65_000);
            expect(mockClient.http.authedRequest).toHaveBeenCalledTimes(4);
        });

        it("says nothing to a server that cannot say which", async () => {
            vi.mocked(mockClient.doesServerSupportUnstableFeature).mockResolvedValue(false);
            const stop = typingStore.holdSelfActivity(roomId, null, "recording_voice");
            await flushPromises();
            stop();
            await flushPromises();
            await vi.advanceTimersByTimeAsync(65_000);
            expect(mockClient.http.authedRequest).not.toHaveBeenCalled();
            expect(mockClient.sendTyping).not.toHaveBeenCalled();

            // And typing is what it always was.
            typingStore.setSelfTyping(roomId, null, true);
            expect(mockClient.sendTyping).toHaveBeenCalledExactlyOnceWith(roomId, true, 30000);
        });

        it("says nothing when it ended before the server answered", async () => {
            typingStore.holdSelfActivity(roomId, null, "recording_voice")();
            await flushPromises();
            expect(mockClient.http.authedRequest).not.toHaveBeenCalled();
            expect(mockClient.sendTyping).not.toHaveBeenCalled();
        });

        it("follows the rules typing follows", async () => {
            typingStore.holdSelfActivity(localRoomId, null, "recording_voice");
            typingStore.holdSelfActivity(roomId, "$thread", "recording_voice");
            vi.mocked(SettingsStore.getValue).mockReturnValue(false);
            typingStore.holdSelfActivity(roomId, null, "recording_voice");
            await flushPromises();
            expect(mockClient.http.authedRequest).not.toHaveBeenCalled();
        });

        it("does not let typing replace the activity, and goes back to typing after it", async () => {
            const stop = typingStore.holdSelfActivity(roomId, null, "uploading_photo");
            await flushPromises();

            typingStore.setSelfTyping(roomId, null, true);
            expect(mockClient.sendTyping).not.toHaveBeenCalled();

            stop();
            await flushPromises();
            expect(mockClient.sendTyping).toHaveBeenCalledExactlyOnceWith(roomId, true, 30000);
        });

        it("does not let the composer going quiet end the activity", async () => {
            typingStore.setSelfTyping(roomId, null, true);
            vi.mocked(mockClient.sendTyping).mockClear();
            const stop = typingStore.holdSelfActivity(roomId, null, "recording_voice");
            await flushPromises();

            typingStore.setSelfTyping(roomId, null, false);
            expect(mockClient.sendTyping).not.toHaveBeenCalled();

            stop();
            await flushPromises();
            expect(mockClient.sendTyping).toHaveBeenCalledExactlyOnceWith(roomId, false, 30000);
        });

        it("tells the newest of several things, and falls back to the one still going", async () => {
            const stopUpload = typingStore.holdSelfActivity(roomId, null, "uploading_file");
            await flushPromises();
            const stopRecording = typingStore.holdSelfActivity(roomId, null, "recording_voice");
            await flushPromises();
            expect(mockClient.http.authedRequest).toHaveBeenLastCalledWith(...activity("recording_voice"));

            stopRecording();
            stopRecording();
            await flushPromises();
            expect(mockClient.http.authedRequest).toHaveBeenLastCalledWith(...activity("uploading_file"));
            expect(mockClient.http.authedRequest).toHaveBeenCalledTimes(3);
            expect(mockClient.sendTyping).not.toHaveBeenCalled();

            stopUpload();
            await flushPromises();
            expect(mockClient.sendTyping).toHaveBeenCalledExactlyOnceWith(roomId, false, 30000);
        });

        it("is reached by the upload path and the recorder through the application's store", async () => {
            holdSelfTypingActivity(roomId, null, "uploading_video")();
            const stop = holdSelfTypingActivity(roomId, null, "uploading_video");
            await flushPromises();
            expect(mockClient.http.authedRequest).toHaveBeenCalledExactlyOnceWith(...activity("uploading_video"));
            stop();
        });
    });
});
