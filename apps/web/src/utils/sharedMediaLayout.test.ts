/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";
import { MatrixEvent } from "matrix-js-sdk/src/matrix";

import { mediaRows, monthKey, rowAtTime, sectionAt, visibleRows, type RowMetrics } from "./sharedMediaLayout";

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
