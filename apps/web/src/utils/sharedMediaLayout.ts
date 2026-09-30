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

/** One month of a room's media, as the server's index counts it. */
export interface MonthSpan {
    /** `YYYY-MM`, UTC. */
    month: string;
    count: number;
    /** The time to open the list at, for this month. */
    before_ts: number;
}

/**
 * The month a scrubber handle at `at` (0 at the newest, 1 at the oldest) is pointing at.
 *
 * Weighted by how much each month holds, not by how many months there are: a month with four
 * hundred photos in it is most of a year's scrolling, and a scrubber that gave it the same slice
 * as a month with three would move at a completely different speed from the column it drives.
 *
 * The months come from the server's index, so this addresses the whole history - including the
 * part that has never been loaded, which is the point. Returns undefined when there are no counts,
 * which is every encrypted room and any homeserver without the index.
 */
export function monthAt(months: readonly MonthSpan[], at: number): MonthSpan | undefined {
    const total = months.reduce((sum, month) => sum + month.count, 0);
    if (!months.length || total <= 0) return undefined;
    // Clamped rather than trusted: a pointer can be dragged past either end of the track.
    const target = Math.min(1, Math.max(0, at)) * total;
    let seen = 0;
    for (const month of months) {
        seen += month.count;
        if (target < seen) return month;
    }
    // Exactly at the far end lands on the oldest month rather than nothing.
    return months[months.length - 1];
}

/**
 * Where to scroll to land on `time`: the first row at or before it, which is the month heading when
 * the date falls in a month the grid holds.
 *
 * The grid runs newest first, so "at or before" means further down the column.
 */
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

/**
 * How tall the scrubber's track is: what can be seen *of it*, not the whole viewport.
 *
 * The track is sticky inside the column, and the column starts below the tabs and header, so until
 * those have scrolled away its top sits that far down. Given the full viewport it hung that far below
 * the fold, and the reader could drag only the part still on screen - which reached only part of the
 * history. That is the scrubber not stretching across the whole timespan.
 */
export function scrubberTrackHeight(scroll: {
    viewport: number;
    offset: number;
    top: number;
    /** How much of the scrolling box's bottom is off the screen, e.g. under a phone's keyboard or edge. */
    belowScreen?: number;
}): number {
    const chromeStillAbove = Math.max(0, scroll.offset - scroll.top);
    return Math.max(0, scroll.viewport - chromeStillAbove - Math.max(0, scroll.belowScreen ?? 0));
}

/*
 * Telegram iOS's scrubber, in its own numbers (SparseItemGridScrollingArea.swift): a 44pt bar that
 * travels between 3pt from the top and 3pt from the bottom, and a 32pt date pill centred on it.
 */
export const SCRUBBER_LINE = 44;
export const SCRUBBER_INSET = 3;
export const SCRUBBER_PILL = 32;

/** How far the bar can travel down a track of this height. */
function travel(track: number): number {
    return Math.max(0, track - 2 * SCRUBBER_INSET - SCRUBBER_LINE);
}

/** Where the bar's top goes for a position `at` (0 newest, 1 oldest): always on the track, bar and all. */
export function scrubberLineTop(at: number, track: number): number {
    return SCRUBBER_INSET + Math.min(1, Math.max(0, at)) * travel(track);
}

/** Where the date pill's top goes: centred on the bar, as Telegram lines them up. */
export function scrubberPillTop(lineTop: number): number {
    return lineTop + (SCRUBBER_LINE - SCRUBBER_PILL) / 2;
}

/**
 * The position a drag has reached: where it started, moved by how far the finger has gone.
 *
 * Relative, as Telegram's is: grabbing the bar does not jump the list to wherever the finger landed,
 * it only moves it as far as the finger then moves.
 */
export function scrubberDragAt(startAt: number, dy: number, track: number): number {
    const room = travel(track);
    if (room <= 0) return Math.min(1, Math.max(0, startAt));
    return Math.min(1, Math.max(0, startAt + dy / room));
}

/**
 * Whether there is enough to scrub: Telegram shows none when more than 55% of the content is on
 * screen. The server's month counts count as content too - they are history not loaded yet.
 */
export function scrubberWorthIt(viewport: number, content: number, months: { month: string }[]): boolean {
    if (months.length > 1) return true;
    return content > 0 && viewport / content < 0.55;
}
