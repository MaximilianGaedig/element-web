/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";

import { listOffsets, listWindow } from "./listWindow";

describe("listOffsets", () => {
    it("uses the estimate for rows nothing has measured yet", () => {
        expect(listOffsets(3, new Map(), 50)).toEqual([0, 50, 100, 150]);
    });

    it("prefers a measured height wherever there is one", () => {
        // The second row turned out to be twice as tall as guessed; everything after it moves down.
        expect(listOffsets(3, new Map([[1, 100]]), 50)).toEqual([0, 50, 150, 200]);
    });

    it("has a single offset for an empty list, which is where it ends", () => {
        expect(listOffsets(0, new Map(), 50)).toEqual([0]);
    });
});

describe("listWindow", () => {
    const offsets = listOffsets(100, new Map(), 50);

    it("renders what is on screen and a little either side", () => {
        const [start, end] = listWindow(offsets, 0, 200, 3);
        expect(start).toBe(0);
        // Four rows fit in 200px, plus the overscan below.
        expect(end).toBe(7);
    });

    it("finds a window far down the list without walking to it", () => {
        const [start, end] = listWindow(offsets, 4000, 200, 0);
        expect(start).toBe(80);
        expect(end).toBe(84);
    });

    it("keeps rows either side so scrolling reveals them rather than filling them in", () => {
        const [withOverscan] = listWindow(offsets, 1000, 200, 3);
        const [without] = listWindow(offsets, 1000, 200, 0);
        expect(without - withOverscan).toBe(3);
    });

    it("never runs past either end", () => {
        expect(listWindow(offsets, 0, 200, 10)[0]).toBe(0);
        expect(listWindow(offsets, 1e9, 200, 10)[1]).toBe(100);
    });

    it("follows the measurements rather than the estimate once they exist", () => {
        // A tall first row pushes the rest down, so the same scroll lands earlier in the list.
        const tall = listOffsets(100, new Map([[0, 500]]), 50);
        expect(listWindow(tall, 500, 200, 0)[0]).toBe(1);
        expect(listWindow(offsets, 500, 200, 0)[0]).toBe(10);
    });

    it("has no window on an empty list", () => {
        expect(listWindow([0], 0, 200)).toEqual([0, 0]);
    });
});
