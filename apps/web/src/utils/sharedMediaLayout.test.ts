/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";
import { MatrixEvent } from "matrix-js-sdk/src/matrix";

import {
    anchorAt,
    anchoredTop,
    mediaRows,
    monthAt,
    monthKey,
    rowAtTime,
    scrubberDragAt,
    scrubberLineTop,
    scrubberPillTop,
    scrubberTrackHeight,
    scrubberWorthIt,
    sectionAt,
    visibleRows,
    type RowMetrics,
} from "./sharedMediaLayout";

const METRICS: RowMetrics = { header: 30, cell: 100, gap: 1 };

let n = 0;
/** A picture sent on a given local date. */
function at(year: number, month: number, day: number): MatrixEvent {
    return new MatrixEvent({
        type: "m.room.message",
        event_id: `$e${++n}`,
        room_id: "!r:x",
        sender: "@a:x",
        origin_server_ts: new Date(year, month - 1, day, 12).getTime(),
        content: { msgtype: "m.image", body: "a", url: "mxc://x/a" },
    });
}

describe("mediaRows", () => {
    it("cuts the column at month boundaries and packs each month into rows", () => {
        // Newest first, as the loader keeps them: three in March, two in February.
        const items = [at(2026, 3, 9), at(2026, 3, 4), at(2026, 3, 1), at(2026, 2, 27), at(2026, 2, 2)];
        const { rows } = mediaRows(items, 3, METRICS);
        expect(
            rows.map((r) => {
                if (r.kind === "header") return `# ${r.section.key}`;
                return r.kind === "cells" ? r.indices.join(",") : `pending ${r.count}`;
            }),
        ).toEqual(["# 2026-03", "0,1,2", "# 2026-02", "3,4"]);
    });

    it("stacks every row where it belongs, with no gap left hanging at the end", () => {
        const items = [at(2026, 3, 9), at(2026, 3, 4), at(2026, 3, 1), at(2026, 2, 27)];
        const { rows, height } = mediaRows(items, 3, METRICS);
        expect(rows.map((r) => r.top)).toEqual([0, 30, 131, 161]);
        // header + row + gap + header + row, and the trailing gap does not count.
        expect(height).toEqual(30 + 100 + 1 + 30 + 100);
    });

    it("gives a short month a short row rather than padding it out", () => {
        const { rows } = mediaRows([at(2026, 3, 9)], 3, METRICS);
        expect(rows).toHaveLength(2);
        expect(rows[1].kind === "cells" && rows[1].indices).toEqual([0]);
    });

    it("has nothing to lay out for nothing", () => {
        expect(mediaRows([], 3, METRICS)).toEqual({ rows: [], height: 0 });
    });

    it("keys months in the reader's own timezone, not UTC", () => {
        // The last midnight of a month is still that month where the reader is.
        expect(monthKey(new Date(2026, 2, 31, 23, 59).getTime())).toBe("2026-03");
        expect(monthKey(new Date(2026, 3, 1, 0, 1).getTime())).toBe("2026-04");
    });
});

describe("visibleRows", () => {
    const items = Array.from({ length: 60 }, (_, i) => at(2026, 3, Math.max(1, 28 - (i % 28))));
    const { rows } = mediaRows(items, 3, METRICS);

    it("renders a window around what is on screen, not the whole column", () => {
        const [start, end] = visibleRows(rows, 0, 300, 2);
        expect(start).toBe(0);
        // Four rows fit in 300px; two more are kept ready on the far side.
        expect(end).toBeLessThan(rows.length);
        expect(rows[end - 1].top).toBeLessThan(300 + 3 * METRICS.cell);
    });

    it("finds the window far down the column without walking to it", () => {
        const deep = rows[rows.length - 1].top;
        const [start, end] = visibleRows(rows, deep, 300, 0);
        expect(start).toBe(rows.length - 1);
        expect(end).toBe(rows.length);
    });

    it("keeps rows either side so scrolling reveals them rather than filling them in", () => {
        const [withOverscan] = visibleRows(rows, 400, 300, 2);
        const [without] = visibleRows(rows, 400, 300, 0);
        expect(without - withOverscan).toBe(2);
    });

    it("has no window on an empty column", () => {
        expect(visibleRows([], 0, 500)).toEqual([0, 0]);
    });
});

describe("jumping to a date", () => {
    const items = [at(2026, 5, 4), at(2026, 3, 9), at(2026, 3, 1), at(2026, 1, 20)];
    const { rows } = mediaRows(items, 3, METRICS);

    it("lands on the month heading for a date the grid covers", () => {
        const march = rows.findIndex((r) => r.kind === "header" && r.section.key === "2026-03");
        expect(rowAtTime(rows, items, new Date(2026, 2, 15).getTime())).toBe(march);
    });

    it("lands on the newest thing there is for a date after everything", () => {
        expect(rowAtTime(rows, items, new Date(2027, 0, 1).getTime())).toBe(0);
    });

    it("lands at the end for a date older than anything in the grid", () => {
        expect(rowAtTime(rows, items, new Date(2000, 0, 1).getTime())).toBe(rows.length - 1);
    });

    it("says which month the top of the viewport is in", () => {
        expect(sectionAt(rows, 0)?.section.key).toBe("2026-05");
        const march = rows.find((r) => r.kind === "header" && r.section.key === "2026-03")!;
        expect(sectionAt(rows, march.top)?.section.key).toBe("2026-03");
        expect(sectionAt(rows, march.top - 1)?.section.key).toBe("2026-05");
    });

    it("only asks for a floating month once the heading it would repeat is gone", () => {
        // Sitting on a heading: it says the month itself, so nothing needs to float over it.
        expect(sectionAt(rows, 0)?.headingVisible).toBe(true);
        const may = rows[0];
        expect(sectionAt(rows, may.top + may.height)?.headingVisible).toBe(false);
    });
});

describe("what has not loaded yet", () => {
    const items = [at(2026, 3, 9), at(2026, 3, 4)];

    it("holds room for the rest of the history, as rows to draw rather than blank space", () => {
        const { rows, height } = mediaRows(items, 3, METRICS, 9);
        const pending = rows.filter((r) => r.kind === "pending");
        // Seven missing: a row of three, then three, then one.
        expect(pending.map((r) => (r.kind === "pending" ? r.count : 0))).toEqual([3, 3, 1]);
        // Header, the loaded row, then three more rows of placeholders.
        expect(height).toBe(30 + 100 + 1 + 3 * (100 + 1) - 1);
    });

    it("lays them below what is loaded, since they are older", () => {
        const { rows } = mediaRows(items, 3, METRICS, 9);
        const lastReal = rows.map((r) => r.kind).lastIndexOf("cells");
        const firstPending = rows.findIndex((r) => r.kind === "pending");
        expect(firstPending).toBeGreaterThan(lastReal);
    });

    it("adds nothing when everything the room holds is already here", () => {
        expect(mediaRows(items, 3, METRICS, 2).rows.some((r) => r.kind === "pending")).toBe(false);
        expect(mediaRows(items, 3, METRICS).rows.some((r) => r.kind === "pending")).toBe(false);
    });

    it("sends a date older than anything loaded into the pending rows", () => {
        const { rows } = mediaRows(items, 3, METRICS, 9);
        const landed = rowAtTime(rows, items, new Date(2020, 0, 1).getTime());
        expect(rows[landed].kind).toBe("pending");
    });
});

describe("monthAt", () => {
    // Newest first, as the index reports them. March is most of the history by volume.
    const months = [
        { month: "2026-05", count: 10, before_ts: 500 },
        { month: "2026-04", count: 10, before_ts: 400 },
        { month: "2026-03", count: 80, before_ts: 300 },
    ];

    it("weights a month by what it holds, not by being a month", () => {
        // The first tenth is May, the second April, and the remaining four fifths are March. By
        // month count alone the handle would spend a third of the track on each, and move at a
        // completely different speed from the column it is driving.
        expect(monthAt(months, 0.05)?.month).toBe("2026-05");
        expect(monthAt(months, 0.15)?.month).toBe("2026-04");
        expect(monthAt(months, 0.5)?.month).toBe("2026-03");
        expect(monthAt(months, 0.9)?.month).toBe("2026-03");
    });

    it("lands on a real month at either end, including exactly at the end", () => {
        expect(monthAt(months, 0)?.month).toBe("2026-05");
        expect(monthAt(months, 1)?.month).toBe("2026-03");
    });

    it("clamps a handle dragged past the track", () => {
        expect(monthAt(months, -3)?.month).toBe("2026-05");
        expect(monthAt(months, 42)?.month).toBe("2026-03");
    });

    it("says nothing when there is nothing to say", () => {
        // Every encrypted room, and any homeserver without the index: the scrubber then falls back
        // to describing what is loaded, so answering with a month here would be an invention.
        expect(monthAt([], 0.5)).toBeUndefined();
        expect(monthAt([{ month: "2026-05", count: 0, before_ts: 500 }], 0.5)).toBeUndefined();
    });
});

/*
 * The rule the scrubber and the scrollbar have to share.
 *
 * They did not: the scrollbar was hidden as soon as a scrolling box was found, while the handle
 * decided for itself, so there were states with no scrollbar and no working scrubber. Exported from
 * the panel and tested here because it is the agreement, not the drawing.
 */
describe("scrubberTrackHeight", () => {
    /*
     * The bug: the track is sticky inside a column that starts below the tabs and header, so at the top
     * of the list a full-viewport track hung below the fold and only part of it could be dragged - which
     * reached only part of the history.
     */
    it("leaves off however much chrome is still above the column", () => {
        expect(scrubberTrackHeight({ viewport: 800, offset: 120, top: 0 })).toBe(680);
    });

    it("takes the whole viewport once that chrome has scrolled away", () => {
        expect(scrubberTrackHeight({ viewport: 800, offset: 120, top: 120 })).toBe(800);
        expect(scrubberTrackHeight({ viewport: 800, offset: 120, top: 900 })).toBe(800);
    });

    it("shrinks as the chrome scrolls, rather than jumping", () => {
        expect(scrubberTrackHeight({ viewport: 800, offset: 120, top: 40 })).toBe(720);
        expect(scrubberTrackHeight({ viewport: 800, offset: 120, top: 80 })).toBe(760);
    });

    it("never goes negative, whatever it is handed", () => {
        expect(scrubberTrackHeight({ viewport: 100, offset: 500, top: 0 })).toBe(0);
    });
});

describe("the scrubber, in Telegram iOS's numbers", () => {
    // The bar used to hang off the bottom of the screen at the oldest end.
    it("keeps the bar on the track at both ends, 3px in", () => {
        expect(scrubberLineTop(0, 600)).toBe(3);
        expect(scrubberLineTop(1, 600)).toBe(600 - 3 - 44);
        expect(scrubberLineTop(5, 600)).toBe(600 - 3 - 44);
    });

    it("centres the date pill on the bar", () => {
        expect(scrubberPillTop(100)).toBe(106);
    });

    // Grabbing the bar must not jump the list to wherever the finger landed.
    it("moves by how far the finger moves, not to where it is", () => {
        const room = 600 - 6 - 44;
        expect(scrubberDragAt(0.25, 0, 600)).toBe(0.25);
        expect(scrubberDragAt(0.25, room / 2, 600)).toBeCloseTo(0.75);
        expect(scrubberDragAt(0.25, -room, 600)).toBe(0);
    });

    it("shows none when most of the content is already on screen, unless there is history to fetch", () => {
        expect(scrubberWorthIt(600, 1000, [])).toBe(false);
        expect(scrubberWorthIt(600, 2000, [])).toBe(true);
        expect(scrubberWorthIt(600, 1000, [{ month: "2026-09" }, { month: "2025-01" }])).toBe(true);
    });

    // A panel taller than the screen (a phone's keyboard or edge): the track stops at the screen.
    it("stops the track at the bottom of the screen", () => {
        expect(scrubberTrackHeight({ viewport: 800, offset: 0, top: 0, belowScreen: 120 })).toBe(680);
    });
});

describe("holding the view still while rows arrive above it", () => {
    // Paging after a jump adds newer history above the month jumped to; the view must not slide.
    it("puts the item at the top of the view back where it was", () => {
        const march = [at(2026, 3, 20), at(2026, 3, 10), at(2026, 3, 5)];
        const before = mediaRows(march, 3, METRICS);
        const y = before.rows[1].top + 20;
        const anchor = anchorAt(before.rows, march, y)!;
        expect(anchor.eventId).toBe(march[0].getId());

        const newer = [at(2026, 9, 1), at(2026, 8, 1), at(2026, 7, 1), at(2026, 6, 1)];
        const all = [...newer, ...march];
        const after = mediaRows(all, 3, METRICS);
        const top = anchoredTop(after.rows, all, anchor)!;
        // The same item, the same distance below the view's top as before.
        const row = after.rows.find((r) => r.kind === "cells" && r.indices.includes(all.indexOf(march[0])))!;
        expect(row.top - top).toBe(before.rows[1].top - y);
        expect(top).toBeGreaterThan(y);
    });

    it("has nothing to hold when the item is gone", () => {
        const one = [at(2026, 3, 20)];
        const anchor = anchorAt(mediaRows(one, 3, METRICS).rows, one, 1)!;
        const other = [at(2026, 4, 1)];
        expect(anchoredTop(mediaRows(other, 3, METRICS).rows, other, anchor)).toBeUndefined();
    });
});
