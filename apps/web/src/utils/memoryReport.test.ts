/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientEvent, type MatrixClient, MatrixEvent, Room, RoomEvent } from "matrix-js-sdk/src/matrix";
import { getMockClientWithEventEmitter } from "test-utils";

import "../performance";
import defaultDispatcher from "../dispatcher/dispatcher";
import SettingsStore from "../settings/SettingsStore";
import { cacheUploadedMedia, clearUploadedMediaCache } from "./UploadedMediaCache";
import { memoryReport } from "./memoryReport";

const message = (roomId: string, n: number): MatrixEvent =>
    new MatrixEvent({
        type: "m.room.message",
        event_id: `$${roomId}-${n}`,
        room_id: roomId,
        sender: "@bob:example.org",
        origin_server_ts: n,
        content: { msgtype: "m.text", body: `message ${n}` },
    });

describe("memoryReport", () => {
    let client: MatrixClient;
    let quiet: Room;
    let busy: Room;

    beforeEach(() => {
        client = getMockClientWithEventEmitter({
            getUserId: vi.fn().mockReturnValue("@alice:example.org"),
            getSafeUserId: vi.fn().mockReturnValue("@alice:example.org"),
            getRooms: vi.fn(),
            getUsers: vi.fn().mockReturnValue([{}, {}, {}]),
            supportsThreads: vi.fn().mockReturnValue(false),
            decryptEventIfNeeded: vi.fn().mockResolvedValue(undefined),
            getPushActionsForEvent: vi.fn(),
        }) as unknown as MatrixClient;
        quiet = new Room("!quiet:example.org", client, "@alice:example.org");
        busy = new Room("!busy:example.org", client, "@alice:example.org");
        quiet.addLiveEvents([message(quiet.roomId, 1)], { addToState: false });
        busy.addLiveEvents(
            Array.from({ length: 25 }, (_, n) => message(busy.roomId, n)),
            { addToState: false },
        );
        vi.mocked(client.getRooms).mockReturnValue([quiet, busy]);
    });

    afterEach(() => {
        clearUploadedMediaCache();
        document.body.innerHTML = "";
    });

    it("has the shape a later report can be compared with", async () => {
        const report = await memoryReport(client);

        expect(report).toEqual({
            at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
            uptimeMinutes: expect.any(Number),
            heap: expect.any(Object),
            caches: {
                ocrResults: expect.any(Number),
                ocrEngineRunning: false,
                barcodeResults: expect.any(Number),
                barcodeReaderRunning: false,
                playbacks: expect.any(Number),
                queuedVoicePlaybacks: expect.any(Number),
                uploadedMedia: { entries: 0, bytes: 0 },
                profileFacts: expect.any(Number),
                biographies: expect.any(Number),
                roomStats: expect.any(Number),
                importSamples: expect.any(Number),
                imagePacks: expect.any(Number),
                messageSendStatuses: 0,
                roomAliases: expect.any(Number),
            },
            sdk: {
                rooms: 2,
                users: 3,
                liveTimelineEvents: 26,
                largestLiveTimelines: [
                    { roomId: busy.roomId, events: 25 },
                    { roomId: quiet.roomId, events: 1 },
                ],
                timelines: 2,
                timelineEvents: 26,
                members: 0,
                largestMemberLists: [],
                threads: 0,
                pendingEvents: 0,
            },
            listeners: {
                client: { total: expect.any(Number), top: expect.any(Array) },
                rooms: expect.any(Number),
                roomStates: expect.any(Number),
                dispatcher: expect.any(Number),
                settingsWatchers: expect.any(Number),
                uiStore: { total: expect.any(Number), top: expect.any(Array) },
                presenceClock: 0,
            },
            dom: {
                nodes: expect.any(Number),
                keptRooms: 0,
                eventTiles: 0,
                images: 0,
                videos: 0,
                audios: 0,
                canvases: 0,
                iframes: 0,
            },
        });
        // It is for copying out of a console and keeping.
        expect(JSON.parse(JSON.stringify(report))).toEqual(report);
    });

    it("counts what was added between two reports", async () => {
        const before = await memoryReport(client);

        const onSync = (): void => {};
        const onTimeline = (): void => {};
        client.on(ClientEvent.Sync, onSync);
        busy.on(RoomEvent.Timeline, onTimeline);
        const dispatcherRef = defaultDispatcher.register(() => {});
        const watcherRef = SettingsStore.watchSetting("useCompactLayout", null, () => {});
        busy.addLiveEvents([message(busy.roomId, 100)], { addToState: false });
        cacheUploadedMedia("mxc://example.org/upload", new Blob(["12345"]));
        document.body.innerHTML = `<div class="mx_RoomView_kept"><div class="mx_EventTile"><img></div></div>`;

        const after = await memoryReport(client);

        expect(after.listeners.client.total - before.listeners.client.total).toBe(1);
        expect(after.listeners.client.top).toContainEqual({ event: ClientEvent.Sync, count: 1 });
        expect(after.listeners.rooms - before.listeners.rooms).toBe(1);
        expect(after.listeners.dispatcher - before.listeners.dispatcher).toBe(1);
        expect(after.listeners.settingsWatchers - before.listeners.settingsWatchers).toBe(1);
        expect(after.sdk.liveTimelineEvents - before.sdk.liveTimelineEvents).toBe(1);
        expect(after.caches.uploadedMedia).toEqual({ entries: 1, bytes: 5 });
        expect(after.dom).toMatchObject({ keptRooms: 1, eventTiles: 1, images: 1 });

        client.off(ClientEvent.Sync, onSync);
        busy.off(RoomEvent.Timeline, onTimeline);
        defaultDispatcher.unregister(dispatcherRef);
        SettingsStore.unwatchSetting(watcherRef);
        expect((await memoryReport(client)).listeners).toEqual(before.listeners);
    });

    it("reports on nothing when nobody is logged in", async () => {
        const report = await memoryReport(null);

        expect(report.sdk).toMatchObject({ rooms: 0, users: 0, liveTimelineEvents: 0 });
        expect(report.listeners.client).toEqual({ total: 0, top: [] });
    });

    it("is there to be called from the console, and loads the report only then", async () => {
        expect(window.mxMemoryReport).toBeInstanceOf(Function);

        const report = await window.mxMemoryReport();

        expect(Object.keys(report)).toEqual(["at", "uptimeMinutes", "heap", "caches", "sdk", "listeners", "dom"]);
    });
});
