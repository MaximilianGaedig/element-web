/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * What the page is holding, counted.
 *
 * `window.mxMemoryReport()` in the console. A heap snapshot says what is using memory; this says how
 * many of each thing there are, which is the half that can be compared between a fresh session and one
 * that has been open all day without a profiler attached: take one after loading, take one nine hours
 * later, and whatever grew is in the difference. Everything here is a count or a byte figure the page
 * can read about itself in a few milliseconds - no snapshot, nothing sent anywhere.
 *
 * Loaded only when asked for (see performance/index.ts), so none of it is on the startup path.
 */

import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { MatrixClientPeg } from "../MatrixClientPeg";
import defaultDispatcher from "../dispatcher/dispatcher";
import SettingsStore from "../settings/SettingsStore";
import UIStore from "../stores/UIStore";
import { PlaybackManager } from "../audio/PlaybackManager";
import { PlaybackQueue } from "../audio/PlaybackQueue";
import { roomAliasesKept } from "../RoomAliasCache";
import { uploadedMediaCacheStats } from "./UploadedMediaCache";
import { MessageSendStatusStore } from "./bridge/messageSendStatus";
import { imagePacksKept } from "./bridge/imagePacks";
import { chatHistoryKept } from "./chatHistory";
import { profileFactsKept } from "./contacts/people";
import { barcodeResultsKept } from "./detect/barcodes";
import { ocrEngineRunning, ocrResultsKept } from "./detect/ocr";
import { transcriberLoaded } from "./detect/transcribe";
import { presenceClockListeners } from "./presence/clock";
import { biographiesKept } from "./profile/biography";

/** How many of the largest things to name, where a total alone would hide which one it is. */
const TOP = 10;

/** Something that can say what is listening to it: the client, a room, a store. */
interface Emitter {
    eventNames(): Array<string | symbol>;
    listenerCount(event: string): number;
}

export interface ListenerCounts {
    /** Every listener on the emitter, all events together. */
    total: number;
    /** The events with the most listeners, most first. */
    top: Array<{ event: string; count: number }>;
}

export interface MemoryReport {
    /** When the report was taken, and how long the page had been open. */
    at: string;
    uptimeMinutes: number;
    /**
     * The JS heap as the browser reports it. `used` and `total` are Chromium's `performance.memory`
     * (coarse, main thread only). `measured` is `performance.measureUserAgentSpecificMemory()`, which
     * includes workers and is only there on a cross-origin-isolated page - the profiling server.
     */
    heap: { used?: number; total?: number; measured?: number; measuredByType?: Record<string, number> };
    /** The page's own caches and engines: the things this report exists to watch. */
    caches: {
        /** Pictures whose text is held (bounded), and whether the text engine's worker is alive. */
        ocrResults: number;
        ocrEngineRunning: boolean;
        barcodeResults: number;
        /** Whether the speech model is loaded. */
        transcriberLoaded: boolean;
        /** Audio playbacks alive, and how many of them voice-message queues are holding. */
        playbacks: number;
        queuedVoicePlaybacks: number;
        /** Files uploaded this session and kept to avoid downloading them back. */
        uploadedMedia: { entries: number; bytes: number };
        profileFacts: number;
        biographies: number;
        roomStats: number;
        importSamples: number;
        imagePacks: number;
        messageSendStatuses: number;
        roomAliases: number;
    };
    /** What the SDK holds in memory. Timeline events are the part that grows with every message. */
    sdk: {
        rooms: number;
        users: number;
        /** Events in every room's live timeline, and the rooms holding the most of them. */
        liveTimelineEvents: number;
        largestLiveTimelines: Array<{ roomId: string; events: number }>;
        /**
         * Timelines of every kind held by rooms' unfiltered timeline sets (live, scrolled back to, jumped
         * to) and the events in all of them. History that was scrolled through stays here: the timeline
         * view lets go of it, the room does not.
         */
        timelines: number;
        timelineEvents: number;
        /** Member objects loaded across all rooms: opening a large room loads all of its members. */
        members: number;
        largestMemberLists: Array<{ roomId: string; members: number }>;
        threads: number;
        pendingEvents: number;
    };
    /** Who is listening to what. A count that only ever goes up is a listener nobody removes. */
    listeners: {
        client: ListenerCounts;
        /** All listeners on all rooms and on their current state, together. */
        rooms: number;
        roomStates: number;
        dispatcher: number;
        settingsWatchers: number;
        uiStore: ListenerCounts;
        presenceClock: number;
    };
    /** The document: how much is mounted. */
    dom: {
        nodes: number;
        keptRooms: number;
        eventTiles: number;
        images: number;
        videos: number;
        audios: number;
        canvases: number;
        iframes: number;
    };
}

function countListeners(emitter: Emitter): ListenerCounts {
    const counts = emitter
        .eventNames()
        .map((event) => ({ event: String(event), count: emitter.listenerCount(event as string) }))
        .sort((a, b) => b.count - a.count);
    return { total: counts.reduce((sum, { count }) => sum + count, 0), top: counts.slice(0, TOP) };
}

/** The `n` largest of `sizes`, largest first, leaving out the empty ones. */
function largest<K extends string>(sizes: Array<{ roomId: string } & Record<K, number>>, key: K): typeof sizes {
    return sizes
        .filter((one) => one[key] > 0)
        .sort((a, b) => b[key] - a[key])
        .slice(0, TOP);
}

function sdkReport(client: MatrixClient | null): MemoryReport["sdk"] {
    const rooms = client?.getRooms() ?? [];
    let liveTimelineEvents = 0;
    let timelines = 0;
    let timelineEvents = 0;
    let members = 0;
    let threads = 0;
    let pendingEvents = 0;
    const timelineSizes: Array<{ roomId: string; events: number }> = [];
    const memberCounts: Array<{ roomId: string; members: number }> = [];
    for (const room of rooms) {
        const events = room.getLiveTimeline().getEvents().length;
        liveTimelineEvents += events;
        timelineSizes.push({ roomId: room.roomId, events });
        for (const timeline of room.getUnfilteredTimelineSet().getTimelines()) {
            timelines++;
            timelineEvents += timeline.getEvents().length;
        }
        const roomMembers = room.currentState.getMembers().length;
        members += roomMembers;
        memberCounts.push({ roomId: room.roomId, members: roomMembers });
        threads += room.getThreads().length;
        try {
            pendingEvents += room.getPendingEvents().length;
        } catch {
            // Only with detached pending events, which is how this app runs the client; a client set
            // up otherwise has them in the timeline, where they are already counted.
        }
    }
    return {
        rooms: rooms.length,
        users: client?.getUsers().length ?? 0,
        liveTimelineEvents,
        largestLiveTimelines: largest(timelineSizes, "events"),
        timelines,
        timelineEvents,
        members,
        largestMemberLists: largest(memberCounts, "members"),
        threads,
        pendingEvents,
    };
}

function listenersReport(client: MatrixClient | null): MemoryReport["listeners"] {
    let rooms = 0;
    let roomStates = 0;
    for (const room of client?.getRooms() ?? []) {
        rooms += countListeners(room).total;
        roomStates += countListeners(room.currentState).total;
    }
    return {
        client: client ? countListeners(client) : { total: 0, top: [] },
        rooms,
        roomStates,
        dispatcher: defaultDispatcher.callbackCount,
        settingsWatchers: SettingsStore.activeWatcherCount,
        uiStore: countListeners(UIStore.instance),
        presenceClock: presenceClockListeners(),
    };
}

function domReport(): MemoryReport["dom"] {
    const count = (selector: string): number => document.querySelectorAll(selector).length;
    return {
        nodes: count("*"),
        keptRooms: count(".mx_RoomView_kept"),
        eventTiles: count(".mx_EventTile"),
        images: count("img"),
        videos: count("video"),
        audios: count("audio"),
        canvases: count("canvas"),
        iframes: count("iframe"),
    };
}

interface MeasuredMemory {
    bytes: number;
    breakdown: Array<{ bytes: number; types: string[] }>;
}

async function heapReport(): Promise<MemoryReport["heap"]> {
    const heap: MemoryReport["heap"] = {};
    const coarse = (performance as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
    if (coarse) {
        heap.used = coarse.usedJSHeapSize;
        heap.total = coarse.totalJSHeapSize;
    }
    const measure = (performance as { measureUserAgentSpecificMemory?: () => Promise<MeasuredMemory> })
        .measureUserAgentSpecificMemory;
    if (measure && globalThis.crossOriginIsolated) {
        try {
            // Resolves at the next garbage collection, which the browser may take its time over.
            const measured = await measure.call(performance);
            heap.measured = measured.bytes;
            heap.measuredByType = {};
            for (const { bytes, types } of measured.breakdown) {
                const type = types.join("+") || "other";
                heap.measuredByType[type] = (heap.measuredByType[type] ?? 0) + bytes;
            }
        } catch {
            // Refused (not isolated after all, or the browser will not say): the counts still stand.
        }
    }
    return heap;
}

/** Counts what the page is holding. See the top of this file for how to use two of these. */
export async function memoryReport(client: MatrixClient | null = MatrixClientPeg.get()): Promise<MemoryReport> {
    const history = chatHistoryKept();
    return {
        at: new Date().toISOString(),
        uptimeMinutes: Math.round(performance.now() / 60_000),
        heap: await heapReport(),
        caches: {
            ocrResults: ocrResultsKept(),
            ocrEngineRunning: ocrEngineRunning(),
            barcodeResults: barcodeResultsKept(),
            transcriberLoaded: transcriberLoaded(),
            playbacks: PlaybackManager.instance.instanceCount,
            queuedVoicePlaybacks: PlaybackQueue.retainedPlaybackCount,
            uploadedMedia: uploadedMediaCacheStats(),
            profileFacts: profileFactsKept(),
            biographies: biographiesKept(),
            roomStats: history.roomStats,
            importSamples: history.importSamples,
            imagePacks: imagePacksKept(),
            messageSendStatuses: client ? MessageSendStatusStore.forClient(client).size : 0,
            roomAliases: roomAliasesKept(),
        },
        sdk: sdkReport(client),
        listeners: listenersReport(client),
        dom: domReport(),
    };
}
