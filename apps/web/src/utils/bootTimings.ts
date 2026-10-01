/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Where the time goes between the page loading and the first message being on screen.
 *
 * Each step of the boot path drops a User Timing mark (`mx_boot:<step>`) at the moment it completes.
 * `window.mxBootTimings()` turns them into measures and returns the breakdown; one `console.info` line
 * prints it when the first message is painted. So one reload gives the whole picture, and it works in a
 * hidden tab too: nothing here depends on a frame being drawn except the one mark that says so.
 *
 * This module is imported by the entry chunk and by modules all over the startup path, so it must stay
 * free of imports: it can then never take part in an import cycle, and costs the entry chunk nothing.
 */

/** The steps, in the order a restored session normally passes them. */
export const BOOT_MARKS = [
    /** The entry script runs. Its time is the page load itself: HTML, entry bundle fetch and parse. */
    "script_start",
    /** The `init` chunk is fetched and evaluated. */
    "init_loaded",
    /** config.json (and the domain-specific config) is loaded. */
    "config_loaded",
    /** Translations and the theme stylesheet are loaded. */
    "i18n_theme_loaded",
    /** Config-declared modules are loaded (normally none). */
    "modules_loaded",
    /** The `element-web-app` chunk is fetched and evaluated. */
    "app_loaded",
    /** The server config is known and `MatrixChat` is handed to React. */
    "app_rendered",
    /** The service worker registration resolved; `detail.controlled` says whether it served this load. */
    "sw_ready",
    /** There is no service worker, or registering it failed. */
    "sw_skipped",
    /** The session lock is held and restoring the stored session begins. */
    "session_restore_start",
    /** The stored tokens and pickle key are read and decrypted. */
    "credentials_loaded",
    /** The storage consistency check (which opens the sync and crypto databases) is done. */
    "storage_checked",
    /** The client exists and the credentials are persisted: `OnLoggedIn` is dispatched. */
    "logged_in",
    /** The sync store is open: IndexedDB connected and the saved sync read into the accumulator. */
    "store_opened",
    /** The crypto store is open: the Rust crypto WASM is loaded and the OlmMachine built. */
    "crypto_opened",
    /** `startClient` returned: the sync loop is set up. */
    "client_started",
    /** The saved sync reached the main thread; `detail` holds its size. */
    "saved_sync_loaded",
    /** The saved sync is replayed into rooms: sync state PREPARED, from the cache. */
    "saved_sync_replayed",
    /** Sync state PREPARED from a live /sync: there was no saved sync to replay. */
    "live_sync_prepared",
    /** The room list has its rooms. */
    "room_list_built",
    /** The logged-in view is committed to the DOM. */
    "logged_in_view",
    /** The first room view is mounted. */
    "room_view_mounted",
    /** The first timeline event is in the DOM. Reliable in a hidden tab. */
    "first_event_in_dom",
    /** The frame holding the first timeline event was painted. Never arrives in a hidden tab. */
    "first_event_painted",
] as const;

export type BootMark = (typeof BOOT_MARKS)[number];

export type BootMarkDetail = Record<string, string | number | boolean>;

const PREFIX = "mx_boot:";
const TOTAL = PREFIX + "total";

/** A mark as the Performance API reports it; the part of `PerformanceMark` the summary reads. */
export interface BootMarkEntry {
    name: string;
    startTime: number;
    detail?: unknown;
}

export interface BootStep {
    /** The step that completed, without the `mx_boot:` prefix. */
    name: string;
    /** When it completed, in ms since the navigation started. */
    at: number;
    /**
     * Time since the previous mark, in ms. Steps that run alongside each other (the service worker, the
     * two store opens) overlap, so this is "what the boot was waiting on last", not the step's own cost.
     */
    sincePrevious: number;
    detail?: BootMarkDetail;
}

export interface BootTimingsSummary {
    steps: BootStep[];
    /** Navigation start to the last mark, in ms. */
    total: number;
    /** When each `mx_PageChange` measure ended, in ms since the navigation started. */
    pageChanges: number[];
    /** The one-line form of this summary. */
    line: string;
}

const seen = new Set<string>();
let reported = false;

function round(ms: number): number {
    return Math.round(ms * 10) / 10;
}

/**
 * Record that a boot step completed. Only the first call for a step counts, so a later login or a client
 * restart does not move the marks of the boot.
 */
export function bootMark(name: BootMark, detail?: BootMarkDetail): void {
    if (seen.has(name)) return;
    seen.add(name);
    try {
        performance.mark(PREFIX + name, detail ? { detail } : undefined);
    } catch {
        // No User Timing (Tor browser): there is nothing to measure with.
    }
}

/**
 * The breakdown for a set of marks: the `mx_boot:` ones in time order, each with the time since the one
 * before it.
 *
 * @param marks - performance marks; ones without the `mx_boot:` prefix are ignored.
 * @param pageChangeEnds - when each `mx_PageChange` measure ended.
 */
export function summariseBootTimings(marks: BootMarkEntry[], pageChangeEnds: number[] = []): BootTimingsSummary {
    const ours = marks
        .filter((mark) => mark.name.startsWith(PREFIX))
        .map((mark, index) => ({ mark, index }))
        // By time; marks made in the same millisecond keep the order they were made in.
        .sort((a, b) => a.mark.startTime - b.mark.startTime || a.index - b.index);

    const steps: BootStep[] = [];
    let previous = 0;
    for (const { mark } of ours) {
        const step: BootStep = {
            name: mark.name.slice(PREFIX.length),
            at: round(mark.startTime),
            sincePrevious: round(mark.startTime - previous),
        };
        if (mark.detail && typeof mark.detail === "object") step.detail = mark.detail as BootMarkDetail;
        steps.push(step);
        previous = mark.startTime;
    }

    const total = round(previous);
    const pageChanges = pageChangeEnds.map(round);

    const parts = steps.map((step) => {
        const detail = step.detail
            ? ` (${Object.entries(step.detail)
                  .map(([key, value]) => `${key}=${value}`)
                  .join(" ")})`
            : "";
        return `${step.name} @${step.at} +${step.sincePrevious}${detail}`;
    });
    const pageChange = pageChanges.length ? ` | mx_PageChange @${pageChanges.join(",")}` : "";
    const line = `mx_boot: ${parts.join(" | ")} | total ${total} ms${pageChange}`;

    return { steps, total, pageChanges, line };
}

/**
 * The boot breakdown so far, as `window.mxBootTimings()`. Also (re)creates one `mx_boot:<step>` measure
 * per step, spanning from the previous mark, and `mx_boot:total`: they show up in a performance profile
 * and in `performance.getEntriesByType("measure")`.
 */
export function mxBootTimings(): BootTimingsSummary {
    let marks: BootMarkEntry[] = [];
    let pageChangeEnds: number[] = [];
    try {
        marks = performance.getEntriesByType("mark").filter((mark) => mark.name.startsWith(PREFIX));
        pageChangeEnds = performance.getEntriesByName("mx_PageChange", "measure").map((m) => m.startTime + m.duration);
    } catch {}

    const summary = summariseBootTimings(marks, pageChangeEnds);

    try {
        for (const measure of performance.getEntriesByType("measure")) {
            if (measure.name.startsWith(PREFIX)) performance.clearMeasures(measure.name);
        }
        for (const step of summary.steps) {
            performance.measure(PREFIX + step.name, { start: step.at - step.sincePrevious, end: step.at });
        }
        if (summary.steps.length) performance.measure(TOTAL, { start: 0, end: summary.total });
    } catch {}

    return summary;
}

/** Print the breakdown, once. Later calls do nothing: the line is the boot's, not a later room switch's. */
export function reportBootTimings(): void {
    if (reported) return;
    reported = true;
    console.info(mxBootTimings().line);
}

/**
 * Wait for the first timeline event to be in the DOM, mark it, mark the frame that paints it, and print
 * the breakdown.
 *
 * It looks only at nodes as they are added, and stops at the first match or after `giveUpAfterMs`, so it
 * costs a selector match per added subtree for the moment between the room view mounting and its first
 * event - and nothing after.
 *
 * @param selector - what a timeline event looks like.
 * @param root - the subtree to watch.
 * @param giveUpAfterMs - print what there is if no event turned up by then (an empty room).
 */
export function watchFirstEvent(
    selector = ".mx_RoomView [data-event-id]",
    root: Element = document.body,
    giveUpAfterMs = 10_000,
): void {
    if (seen.has("first_event_in_dom")) return;

    const observer = new MutationObserver((records) => {
        for (const record of records) {
            for (const node of record.addedNodes) {
                if (node.nodeType !== 1) continue;
                const element = node as Element;
                if (element.matches(selector) || element.querySelector(selector)) return found();
            }
        }
    });
    const giveUp = setTimeout(() => {
        observer.disconnect();
        reportBootTimings();
    }, giveUpAfterMs);

    function found(): void {
        observer.disconnect();
        clearTimeout(giveUp);
        bootMark("first_event_in_dom");

        // A hidden tab runs no animation frames: print without the paint mark rather than never.
        const fallback = setTimeout(reportBootTimings, 1000);
        if (typeof requestAnimationFrame !== "function") return;
        requestAnimationFrame(() => {
            // A task queued from an animation frame runs once that frame has been painted.
            const channel = new MessageChannel();
            channel.port1.onmessage = (): void => {
                channel.port1.close();
                clearTimeout(fallback);
                bootMark("first_event_painted");
                reportBootTimings();
            };
            channel.port2.postMessage(null);
        });
    }

    if (root.querySelector(selector)) return found();
    observer.observe(root, { childList: true, subtree: true });
}

/** The part of a saved sync that says how much there is to replay. */
interface SavedSyncLike {
    roomsData?: {
        join?: Record<string, { timeline?: { events?: unknown[] }; state?: { events?: unknown[] } }>;
    };
    accountData?: unknown[];
}

/**
 * How much a saved sync holds, for the `saved_sync_loaded` mark. It counts array lengths per room and
 * touches no event, so it stays cheap however large the saved sync is.
 */
export function savedSyncSize(saved: SavedSyncLike | null | undefined): BootMarkDetail {
    if (!saved) return { rooms: 0, timelineEvents: 0, stateEvents: 0, accountData: 0 };
    let rooms = 0;
    let timelineEvents = 0;
    let stateEvents = 0;
    const joined = saved.roomsData?.join ?? {};
    for (const roomId in joined) {
        rooms++;
        timelineEvents += joined[roomId].timeline?.events?.length ?? 0;
        stateEvents += joined[roomId].state?.events?.length ?? 0;
    }
    return { rooms, timelineEvents, stateEvents, accountData: saved.accountData?.length ?? 0 };
}

/**
 * Forget the marks made so far.
 * @knipignore - exported for tests
 */
export function resetBootTimings(): void {
    seen.clear();
    reported = false;
    try {
        for (const name of BOOT_MARKS) performance.clearMarks(PREFIX + name);
        for (const measure of performance.getEntriesByType("measure")) {
            if (measure.name.startsWith(PREFIX)) performance.clearMeasures(measure.name);
        }
    } catch {}
}

if (typeof window !== "undefined") {
    window.mxBootTimings = mxBootTimings;
}
