/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    bootMark,
    mxBootTimings,
    reportBootTimings,
    resetBootTimings,
    savedSyncSize,
    summariseBootTimings,
    watchFirstEvent,
} from "./bootTimings";

describe("summariseBootTimings", () => {
    it("orders the boot marks by time and gives each the time since the one before", () => {
        const summary = summariseBootTimings([
            { name: "mx_boot:config_loaded", startTime: 310.04 },
            { name: "mx_boot:script_start", startTime: 120 },
            { name: "mx_boot:init_loaded", startTime: 250.26 },
        ]);

        expect(summary.steps).toEqual([
            { name: "script_start", at: 120, sincePrevious: 120 },
            { name: "init_loaded", at: 250.3, sincePrevious: 130.3 },
            { name: "config_loaded", at: 310, sincePrevious: 59.8 },
        ]);
        expect(summary.total).toBe(310);
    });

    it("ignores marks that are not the boot's", () => {
        const summary = summariseBootTimings([
            { name: "start:mx_PageChange", startTime: 5 },
            { name: "mx_boot:script_start", startTime: 100 },
            { name: "something_else", startTime: 4000 },
        ]);

        expect(summary.steps.map((step) => step.name)).toEqual(["script_start"]);
        expect(summary.total).toBe(100);
    });

    it("keeps marks made at the same instant in the order they were made", () => {
        const summary = summariseBootTimings([
            { name: "mx_boot:store_opened", startTime: 900 },
            { name: "mx_boot:crypto_opened", startTime: 900 },
            { name: "mx_boot:logged_in", startTime: 400 },
        ]);

        expect(summary.steps.map((step) => step.name)).toEqual(["logged_in", "store_opened", "crypto_opened"]);
        expect(summary.steps[2].sincePrevious).toBe(0);
    });

    it("carries a mark's detail into the step and the line", () => {
        const summary = summariseBootTimings([
            { name: "mx_boot:saved_sync_loaded", startTime: 800, detail: { rooms: 212, timelineEvents: 2800 } },
        ]);

        expect(summary.steps[0].detail).toEqual({ rooms: 212, timelineEvents: 2800 });
        expect(summary.line).toBe(
            "mx_boot: saved_sync_loaded @800 +800 (rooms=212 timelineEvents=2800) | total 800 ms",
        );
    });

    it("prints one line with every step, the total and the existing page-change marker", () => {
        const summary = summariseBootTimings(
            [
                { name: "mx_boot:script_start", startTime: 100 },
                { name: "mx_boot:first_event_in_dom", startTime: 3100 },
            ],
            [1500.44, 3090],
        );

        expect(summary.pageChanges).toEqual([1500.4, 3090]);
        expect(summary.line).toBe(
            "mx_boot: script_start @100 +100 | first_event_in_dom @3100 +3000 | total 3100 ms | mx_PageChange @1500.4,3090",
        );
    });

    it("is empty, not broken, when nothing was marked", () => {
        expect(summariseBootTimings([])).toEqual({
            steps: [],
            total: 0,
            pageChanges: [],
            line: "mx_boot:  | total 0 ms",
        });
    });
});

describe("savedSyncSize", () => {
    it("counts the rooms and events a saved sync will replay", () => {
        const size = savedSyncSize({
            roomsData: {
                join: {
                    "!a:server": { timeline: { events: [{}, {}, {}] }, state: { events: [{}] } },
                    "!b:server": { timeline: { events: [{}] }, state: { events: [{}, {}] } },
                    "!c:server": {},
                },
            },
            accountData: [{}, {}],
        });

        expect(size).toEqual({ rooms: 3, timelineEvents: 4, stateEvents: 3, accountData: 2 });
    });

    it("is all zeroes when there is no saved sync", () => {
        expect(savedSyncSize(null)).toEqual({ rooms: 0, timelineEvents: 0, stateEvents: 0, accountData: 0 });
    });
});

describe("bootMark", () => {
    beforeEach(() => {
        resetBootTimings();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
        resetBootTimings();
        document.body.innerHTML = "";
    });

    it("makes a prefixed User Timing mark", () => {
        bootMark("config_loaded");

        const marks = performance.getEntriesByName("mx_boot:config_loaded", "mark");
        expect(marks).toHaveLength(1);
    });

    it("counts only the first mark of a step, so a later login does not move the boot's", () => {
        bootMark("logged_in");
        bootMark("logged_in");

        expect(performance.getEntriesByName("mx_boot:logged_in", "mark")).toHaveLength(1);
    });

    it("never throws where there is no User Timing", () => {
        vi.spyOn(performance, "mark").mockImplementation(() => {
            throw new Error("no User Timing here");
        });

        expect(() => bootMark("config_loaded")).not.toThrow();
    });

    it("is read back, in order and with measures, by window.mxBootTimings()", () => {
        bootMark("script_start");
        bootMark("saved_sync_loaded", { rooms: 3 });

        const summary = window.mxBootTimings();

        expect(summary.steps.map((step) => step.name)).toEqual(["script_start", "saved_sync_loaded"]);
        expect(summary.steps[1].detail).toEqual({ rooms: 3 });
        const measures = performance.getEntriesByType("measure").map((measure) => measure.name);
        expect(measures).toEqual(
            expect.arrayContaining(["mx_boot:script_start", "mx_boot:saved_sync_loaded", "mx_boot:total"]),
        );
        // Asking again replaces the measures rather than piling them up.
        mxBootTimings();
        expect(performance.getEntriesByName("mx_boot:total", "measure")).toHaveLength(1);
    });

    it("prints the breakdown once", () => {
        const info = vi.spyOn(console, "info").mockImplementation(() => {});
        bootMark("script_start");

        reportBootTimings();
        reportBootTimings();

        expect(info).toHaveBeenCalledTimes(1);
        expect(info.mock.calls[0][0]).toMatch(/^mx_boot: script_start @[\d.]+ \+[\d.]+ \| total [\d.]+ ms$/);
    });

    describe("watchFirstEvent", () => {
        function addEvent(): void {
            const tile = document.createElement("li");
            tile.setAttribute("data-event-id", "$event");
            document.querySelector(".mx_RoomView")!.appendChild(tile);
        }

        beforeEach(() => {
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
            vi.spyOn(console, "info").mockImplementation(() => {});
            document.body.innerHTML = `<div class="mx_RoomView"></div><div class="list" data-event-id="$x"></div>`;
        });

        function marked(name: string): boolean {
            return performance.getEntriesByName(`mx_boot:${name}`, "mark").length > 0;
        }

        it("marks the first timeline event when it is added, and not for a look-alike outside the room", async () => {
            watchFirstEvent();
            await Promise.resolve();
            expect(marked("first_event_in_dom")).toBe(false);

            addEvent();
            await vi.waitFor(() => expect(marked("first_event_in_dom")).toBe(true));
        });

        it("marks straight away when the event is already there", () => {
            addEvent();

            watchFirstEvent();

            expect(marked("first_event_in_dom")).toBe(true);
        });

        it("prints the breakdown in a hidden tab, where no frame is ever painted", () => {
            vi.stubGlobal(
                "requestAnimationFrame",
                vi.fn(() => 0),
            );
            addEvent();

            watchFirstEvent();
            expect(console.info).not.toHaveBeenCalled();
            vi.advanceTimersByTime(1000);

            expect(console.info).toHaveBeenCalledTimes(1);
            expect(marked("first_event_painted")).toBe(false);
            vi.unstubAllGlobals();
        });

        it("marks the paint once the frame after the event has been drawn", async () => {
            vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
                callback(0);
                return 0;
            });
            addEvent();

            watchFirstEvent();

            await vi.waitFor(() => expect(marked("first_event_painted")).toBe(true));
            expect(console.info).toHaveBeenCalledTimes(1);
            vi.unstubAllGlobals();
        });

        it("gives up on a room with no events and prints what there is", () => {
            watchFirstEvent(undefined, undefined, 5000);

            vi.advanceTimersByTime(5000);

            expect(console.info).toHaveBeenCalledTimes(1);
            expect(marked("first_event_in_dom")).toBe(false);
        });
    });
});
