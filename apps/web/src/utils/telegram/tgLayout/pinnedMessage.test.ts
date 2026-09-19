/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";

import {
    borderGeometry,
    getBarHeight,
    getTrackTranslateY,
    nextPinnedIndexAfterFollow,
    pinnedCounter,
    superSides,
    toPinnedIndex,
} from "./pinnedMessage";

describe("tweb pinned-message plate", () => {
    it("uses tweb's bar heights", () => {
        expect([1, 2, 3, 4, 5, 9].map(getBarHeight)).toEqual([40, 19, 12, 10, 10, 10]);
    });

    it("places the mark like pinnedMessageBorder.ts", () => {
        expect(borderGeometry(2, 0).markTranslateY).toBe(0);
        expect(borderGeometry(2, 1).markTranslateY).toBe(21);
        expect(borderGeometry(3, 1).markTranslateY).toBe(14);
        expect(borderGeometry(3, 2).markTranslateY).toBe(29);
        expect(borderGeometry(4, 3).markTranslateY).toBe(36);
        expect(borderGeometry(4, 3).trackHeight).toBe(46);
    });

    it("scrolls a long track and masks its ends", () => {
        // 6 pins: 10px bars, track 70px tall, window 40px.
        expect(getTrackTranslateY(0, 6, 10, 70)).toBe(0);
        expect(getTrackTranslateY(2, 6, 10, 70)).toBe(4);
        expect(getTrackTranslateY(3, 6, 10, 70)).toBe(16);
        expect(getTrackTranslateY(5, 6, 10, 70)).toBe(30);
        expect(borderGeometry(6, 0)).toMatchObject({ mask: true, maskTop: false, maskBottom: true });
        expect(borderGeometry(6, 3)).toMatchObject({ mask: true, maskTop: true, maskBottom: true });
        expect(borderGeometry(6, 5)).toMatchObject({ mask: true, maskTop: true, maskBottom: false });
        expect(borderGeometry(4, 0).mask).toBe(false);
    });

    it("draws two bars with a double gap", () => {
        expect(borderGeometry(2, 0).clipPathD).toBe(
            "M0,1.5a1.5,1.5,0,0,1,3,0v16a1.5,1.5,0,0,1,-3,0ZM0,24.5a1.5,1.5,0,0,1,3,0v16a1.5,1.5,0,0,1,-3,0Z",
        );
    });

    it("maps Element's oldest-first index to tweb's newest-first one", () => {
        expect(toPinnedIndex(4, 3)).toBe(0);
        expect(toPinnedIndex(4, 0)).toBe(3);
    });

    it("counts #N and hides it on the newest pin", () => {
        expect(pinnedCounter(0, 4)).toEqual({ value: 4, isLast: true });
        expect(pinnedCounter(2, 4)).toEqual({ value: 2, isLast: false });
    });

    it("follows to the next older pin and wraps to the newest", () => {
        expect(nextPinnedIndexAfterFollow(0, 3)).toBe(1);
        expect(nextPinnedIndexAfterFollow(2, 3)).toBe(0);
    });

    it("slides older pins in from the top and newer ones from the bottom", () => {
        expect(superSides(1, 0)).toEqual({ enter: "from-top", leave: "from-bottom" });
        expect(superSides(0, 2)).toEqual({ enter: "from-bottom", leave: "from-top" });
    });
});
