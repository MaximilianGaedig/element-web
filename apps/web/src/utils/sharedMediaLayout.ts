/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Where every row of the shared-media grid sits, worked out as numbers rather than as DOM.
 *
 * Telegram's shared media is one list from today back to the first picture, cut into months, and it
 * stays smooth on a chat with tens of thousands of them because only what is on screen exists. Both
 * halves need the same thing: the position of every row without having rendered any of them. The
 * cells are square and the columns equal, so a row's height follows from the container's width and
 * the whole column can be laid out arithmetically.
 *
 * Kept away from React so the arithmetic can be tested on its own - it is the part that is easy to
 * get subtly wrong and impossible to see going wrong.
 */

import { type MatrixEvent } from "matrix-js-sdk/src/matrix";

/** A month of the grid: Telegram cuts shared media at month boundaries. */
export interface MediaSection {
    /** Sortable and stable: the month this section covers, as `YYYY-MM` in local time. */
    key: string;
    /** When the month starts, for jumping to a date. */
    time: number;
}

export type MediaRow =
    | { kind: "header"; section: MediaSection; top: number; height: number }
    | { kind: "cells"; indices: number[]; section: MediaSection; top: number; height: number }
    /** Room held for what has not been fetched yet, drawn as placeholders. */
    | { kind: "pending"; count: number; section?: MediaSection; top: number; height: number };

export interface RowMetrics {
    /** The height of a month heading. */
    header: number;
    /** The height of one row of cells, which for square cells is the column width. */
    cell: number;
    /** The gap between cells, which is also the gap between rows. */
    gap: number;
}

/** The month an event belongs to, in the reader's own timezone rather than UTC. */
export function monthKey(ts: number): string {
    const date = new Date(ts);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** The first instant of the month an event belongs to. */
function monthStart(ts: number): number {
    const date = new Date(ts);
    return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

/**
 * Lays the whole grid out: a heading per month, then that month's items in rows of `columns`.
 *
 * `items` are newest first, as the loader keeps them, and the result is in the same order - so a
 * row's `indices` point straight back into the caller's array and nothing has to be re-matched.
 */
export function mediaRows(
    items: readonly MatrixEvent[],
    columns: number,
    metrics: RowMetrics,
    /** How many the room holds in all, so the rest can be held room for and drawn as placeholders. */
    total = 0,
): { rows: MediaRow[]; height: number } {
    const rows: MediaRow[] = [];
    let top = 0;
    let section: MediaSection | undefined;
    let pending: number[] = [];

    const flush = (): void => {
        if (!pending.length || !section) return;
        rows.push({ kind: "cells", indices: pending, section, top, height: metrics.cell });
        top += metrics.cell + metrics.gap;
        pending = [];
    };

    for (let i = 0; i < items.length; i++) {
        const ts = items[i].getTs();
        const key = monthKey(ts);
        if (key !== section?.key) {
            flush();
            section = { key, time: monthStart(ts) };
            rows.push({ kind: "header", section, top, height: metrics.header });
            top += metrics.header;
        }
        pending.push(i);
        if (pending.length === columns) flush();
    }
    flush();

    /*
     * What has not arrived yet is older than everything here, so it belongs below - as rows of
     * placeholders rather than as blank space, which would read as the end of the list.
     */
    let missing = Math.max(0, total - items.length);
    while (missing > 0) {
        const count = Math.min(columns, missing);
        rows.push({ kind: "pending", count, section, top, height: metrics.cell });
        top += metrics.cell + metrics.gap;
        missing -= count;
    }

    // The gap after the final row is not part of the column's height.
    return { rows, height: Math.max(0, top - (rows.length ? metrics.gap : 0)) };
}

/**
 * Which rows to actually render for a given scroll position.
 *
 * `overscan` rows are kept either side so that scrolling reveals rows that are already there rather
 * than blank space that fills in afterwards. Returns a half-open range.
 */
export function visibleRows(
    rows: readonly MediaRow[],
    scrollTop: number,
    viewport: number,
    overscan = 2,
): [number, number] {
    if (!rows.length) return [0, 0];
    // Rows are in ascending `top` order, so the first visible one is a binary search away; walking
    // the list would make scrolling cost more the further down it went.
    let lo = 0;
    let hi = rows.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (rows[mid].top + rows[mid].height <= scrollTop) lo = mid + 1;
        else hi = mid;
    }
    let end = lo;
    while (end < rows.length && rows[end].top < scrollTop + viewport) end++;
    return [Math.max(0, lo - overscan), Math.min(rows.length, end + overscan)];
}

/**
 * Where to scroll to land on `time`: the first row at or before it, which is the month heading when
 * the date falls in a month the grid holds.
 *
 * The grid runs newest first, so "at or before" means further down the column.
 */
/** @knipignore Where the date scrubber will land a jump (MEO-7); pinned by tests until it does. */
export function rowAtTime(rows: readonly MediaRow[], items: readonly MatrixEvent[], time: number): number {
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (row.kind === "header" && row.section.time <= time) return i;
        if (row.kind === "cells" && row.indices.some((index) => items[index].getTs() <= time)) return i;
        // A pending row stands for events older than everything loaded, so any earlier date is in it.
        if (row.kind === "pending") return i;
    }
    return rows.length ? rows.length - 1 : 0;
}

/**
 * The month over the top of the viewport, and whether its own heading has scrolled away.
 *
 * Both are needed to avoid saying the same thing twice: a floating month is worth showing exactly
 * when the heading it repeats is no longer on screen.
 */
export function sectionAt(
    rows: readonly MediaRow[],
    scrollTop: number,
): { section: MediaSection; headingVisible: boolean } | undefined {
    let current: MediaRow | undefined;
    let heading: MediaRow | undefined;
    for (const row of rows) {
        if (row.top > scrollTop) break;
        if (row.section) current = row;
        if (row.kind === "header") heading = row;
    }
    const row = current ?? rows[0];
    if (!row?.section) return undefined;
    // The heading is still doing its job while any part of it is above the fold.
    const visible = !heading || heading.top + heading.height > scrollTop;
    return { section: row.section, headingVisible: visible };
}
