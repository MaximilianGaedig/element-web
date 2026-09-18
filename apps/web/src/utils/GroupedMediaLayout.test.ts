/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect } from "vitest";
import { ALBUM_MAX_WIDTH, ALBUM_MIN_WIDTH, ALBUM_SPACING, layoutAlbum, RectPart } from "./GroupedMediaLayout";

/**
 * Expected values were produced by running Telegram Web K's own src/components/groupedLayout.ts
 * (morethanwords/tweb, GPL-3.0) with the parameters tweb's wrapAlbum uses on desktop:
 * maxWidth 420, minWidth 100, spacing 1. Items are [x, y, width, height, sides].
 */
const TWEB_REFERENCE: Record<string, { sizes: number[][]; width: number; height: number; items: number[][] }> = {
    two_equal_square: {
        sizes: [
            [100, 100],
            [100, 100],
        ],
        width: 420,
        height: 210,
        items: [
            [0, 0, 209.5, 210, 13],
            [210.5, 0, 209.5, 210, 7],
        ],
    },
    two_wide_topbottom: {
        sizes: [
            [1600, 900],
            [1600, 900],
        ],
        width: 420,
        height: 421,
        items: [
            [0, 0, 420, 210, 11],
            [0, 211, 420, 210, 14],
        ],
    },
    two_left_right: {
        sizes: [
            [900, 1600],
            [1000, 1000],
        ],
        width: 420,
        height: 268,
        items: [
            [0, 0, 151, 268, 13],
            [152, 0, 268, 268, 7],
        ],
    },
    three_left_and_other: {
        sizes: [
            [600, 1000],
            [1000, 800],
            [800, 800],
        ],
        width: 420,
        height: 420,
        items: [
            [0, 0, 209, 420, 13],
            [210, 0, 210, 209, 3],
            [210, 210, 210, 210, 6],
        ],
    },
    three_top_and_other: {
        sizes: [
            [1600, 900],
            [900, 900],
            [800, 1000],
        ],
        width: 420,
        height: 420,
        items: [
            [0, 0, 420, 236, 11],
            [0, 237, 209.5, 183, 12],
            [210.5, 237, 209.5, 183, 6],
        ],
    },
    four_top_and_other: {
        sizes: [
            [1600, 900],
            [900, 1600],
            [1000, 1000],
            [1200, 900],
        ],
        width: 420,
        height: 381,
        items: [
            [0, 0, 420, 236, 11],
            [0, 237, 100, 144, 12],
            [101, 237, 126, 144, 4],
            [228, 237, 192, 144, 6],
        ],
    },
    four_left_and_other: {
        sizes: [
            [800, 1200],
            [1600, 900],
            [900, 900],
            [1200, 800],
        ],
        width: 420,
        height: 420,
        items: [
            [0, 0, 251, 420, 13],
            [252, 0, 168, 106, 3],
            [252, 107, 168, 188, 2],
            [252, 296, 168, 124, 6],
        ],
    },
    two_panorama_complex: {
        sizes: [
            [3000, 1000],
            [1000, 1000],
        ],
        width: 420,
        height: 574,
        items: [
            [0, 0, 420, 153, 11],
            [0, 154, 420, 420, 14],
        ],
    },
    five_mixed: {
        sizes: [
            [1600, 900],
            [900, 1600],
            [1000, 1000],
            [1200, 900],
            [800, 1200],
        ],
        width: 420,
        height: 628,
        items: [
            [0, 0, 420, 236, 11],
            [0, 237, 210, 210, 8],
            [211, 237, 209, 210, 2],
            [0, 448, 239, 180, 12],
            [240, 448, 180, 180, 6],
        ],
    },
    seven_mixed: {
        sizes: [
            [1600, 900],
            [1600, 900],
            [900, 1600],
            [1000, 1000],
            [1200, 900],
            [800, 1200],
            [3000, 1000],
        ],
        width: 420,
        height: 596,
        items: [
            [0, 0, 163, 92, 9],
            [164, 0, 163, 92, 1],
            [328, 0, 92, 92, 3],
            [0, 93, 420, 420, 10],
            [0, 514, 110, 82, 12],
            [111, 514, 82, 82, 4],
            [194, 514, 226, 82, 6],
        ],
    },
    ten_portrait: {
        sizes: [
            [900, 1600],
            [910, 1560],
            [920, 1520],
            [930, 1480],
            [940, 1440],
            [950, 1400],
            [960, 1360],
            [970, 1320],
            [980, 1280],
            [990, 1240],
        ],
        width: 420,
        height: 546,
        items: [
            [0, 0, 139, 209, 9],
            [140, 0, 139, 209, 1],
            [280, 0, 140, 209, 3],
            [0, 210, 102, 153, 8],
            [103, 210, 102, 153, 0],
            [206, 210, 104, 153, 0],
            [311, 210, 109, 153, 2],
            [0, 364, 134, 182, 12],
            [135, 364, 139, 182, 4],
            [275, 364, 145, 182, 6],
        ],
    },
    ten_landscape: {
        sizes: [
            [1600, 900],
            [1650, 900],
            [1700, 900],
            [1750, 900],
            [1800, 900],
            [1850, 900],
            [1900, 900],
            [1950, 900],
            [2000, 900],
            [2050, 900],
        ],
        width: 420,
        height: 444,
        items: [
            [0, 0, 420, 236, 11],
            [0, 237, 135, 74, 8],
            [136, 237, 139, 74, 0],
            [276, 237, 144, 74, 2],
            [0, 312, 136, 68, 8],
            [137, 312, 139, 68, 0],
            [277, 312, 143, 68, 2],
            [0, 381, 136, 63, 12],
            [137, 381, 139, 63, 4],
            [277, 381, 143, 63, 6],
        ],
    },
};

describe("GroupedMediaLayout (port of tweb's Layouter)", () => {
    it("uses tweb's desktop album parameters", () => {
        expect([ALBUM_MAX_WIDTH, ALBUM_MIN_WIDTH, ALBUM_SPACING]).toEqual([420, 100, 1]);
    });

    it.each(Object.entries(TWEB_REFERENCE))("matches tweb for %s", (_name, ref) => {
        const layout = layoutAlbum(ref.sizes.map(([w, h]) => ({ w, h })));
        expect(layout.width).toBe(ref.width);
        expect(layout.height).toBe(ref.height);
        expect(layout.items.map(({ geometry: g, sides }) => [g.x, g.y, g.width, g.height, sides])).toEqual(ref.items);
    });

    it("never overlaps items and keeps them inside the album box", () => {
        for (const ref of Object.values(TWEB_REFERENCE)) {
            const layout = layoutAlbum(ref.sizes.map(([w, h]) => ({ w, h })));
            for (const { geometry: a } of layout.items) {
                expect(a.x + a.width).toBeLessThanOrEqual(layout.width + 0.5);
                expect(a.y + a.height).toBeLessThanOrEqual(layout.height + 0.5);
            }
            layout.items.forEach(({ geometry: a }, i) =>
                layout.items.slice(i + 1).forEach(({ geometry: b }) => {
                    const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
                    const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
                    expect(overlapX <= 0 || overlapY <= 0).toBe(true);
                }),
            );
        }
    });

    it("marks the outer edges so the corners can be rounded", () => {
        const { items } = layoutAlbum([
            { w: 100, h: 100 },
            { w: 100, h: 100 },
        ]);
        expect(items[0].sides).toBe(RectPart.Top | RectPart.Left | RectPart.Bottom);
        expect(items[1].sides).toBe(RectPart.Top | RectPart.Right | RectPart.Bottom);
    });

    it("lays out nothing for no items", () => {
        expect(layoutAlbum([])).toEqual({ width: 0, height: 0, items: [] });
    });
});
