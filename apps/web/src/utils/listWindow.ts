/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Where every row of a list sits, for rows whose heights are not known in advance.
 *
 * The media grid can work its layout out arithmetically because every cell is the same square
 * (sharedMediaLayout.ts). The other tabs cannot: a link with a preview is taller than one without,
 * a file row grows with the length of its name. So each row is measured as it renders and the
 * offsets are built from what has been measured so far, with an estimate standing in for the rest.
 *
 * The estimate being wrong is not a correctness problem - it only means the column's total height
 * is approximate until everything has been seen once, which is how every list of this kind behaves.
 */

/** Running offsets for `count` rows: `offsets[i]` is where row `i` starts, and the last is the end. */
export function listOffsets(count: number, measured: ReadonlyMap<number, number>, estimate: number): number[] {
    const offsets = new Array<number>(count + 1);
    offsets[0] = 0;
    for (let i = 0; i < count; i++) offsets[i + 1] = offsets[i] + (measured.get(i) ?? estimate);
    return offsets;
}

/**
 * Which rows to render for a given scroll position, as a half-open range.
 *
 * `overscan` rows either side are kept so that scrolling reveals rows that are already there.
 */
export function listWindow(
    offsets: readonly number[],
    scrollTop: number,
    viewport: number,
    overscan = 3,
): [number, number] {
    const count = offsets.length - 1;
    if (count <= 0) return [0, 0];

    // Offsets ascend, so the first visible row is a binary search away rather than a walk - which
    // would make scrolling to the far end cost more than scrolling to the near one.
    let lo = 0;
    let hi = count - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (offsets[mid + 1] <= scrollTop) lo = mid + 1;
        else hi = mid;
    }
    let end = lo;
    while (end < count && offsets[end] < scrollTop + viewport) end++;
    return [Math.max(0, lo - overscan), Math.min(count, end + overscan)];
}
