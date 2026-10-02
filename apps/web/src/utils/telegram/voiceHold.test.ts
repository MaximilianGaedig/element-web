/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, it, expect } from "vitest";

import {
    dragFrom,
    feedbackOf,
    locknessOf,
    outcomeOnRelease,
    outcomeWhileDragging,
    scaleOf,
    velocityOf,
} from "./voiceHold";

const still = { x: 0, y: 0 };

describe("holding the microphone, by Telegram iOS's rules", () => {
    it("counts only travel to the left and up", () => {
        expect(dragFrom({ x: 300, y: 600 }, { x: 250, y: 560 })).toEqual({ dx: -50, dy: -40 });
        expect(dragFrom({ x: 300, y: 600 }, { x: 340, y: 650 })).toEqual({ dx: 0, dy: 0 });
    });

    it("cancels on the spot past 150 to the left, and locks past 110 up", () => {
        expect(outcomeWhileDragging({ dx: -150, dy: 0 })).toBeNull();
        expect(outcomeWhileDragging({ dx: -151, dy: 0 })).toBe("cancel");
        expect(outcomeWhileDragging({ dx: 0, dy: -110 })).toBeNull();
        expect(outcomeWhileDragging({ dx: 0, dy: -111 })).toBe("lock");
    });

    it("sends when the finger is let go where it went down", () => {
        expect(outcomeOnRelease({ dx: 0, dy: 0 }, still)).toBe("send");
        expect(outcomeOnRelease({ dx: -100, dy: 0 }, still)).toBe("send");
        expect(outcomeOnRelease({ dx: 0, dy: -60 }, still)).toBe("send");
    });

    it("cancels when let go past 100 to the left, and locks past 60 up", () => {
        expect(outcomeOnRelease({ dx: -101, dy: 0 }, still)).toBe("cancel");
        expect(outcomeOnRelease({ dx: 0, dy: -61 }, still)).toBe("lock");
    });

    it("goes by the direction travelled furthest", () => {
        // Far enough up to lock, but further left: the upward travel does not count
        expect(outcomeOnRelease({ dx: -90, dy: -70 }, still)).toBe("send");
        // ...and the other way round
        expect(outcomeOnRelease({ dx: -105, dy: -108 }, still)).toBe("lock");
    });

    it("takes a flick for the whole slide", () => {
        expect(outcomeOnRelease({ dx: -20, dy: 0 }, { x: -401, y: 0 })).toBe("cancel");
        expect(outcomeOnRelease({ dx: 0, dy: -20 }, { x: 0, y: -401 })).toBe("lock");
        expect(outcomeOnRelease({ dx: -20, dy: 0 }, { x: -400, y: 0 })).toBe("send");
        // A flick to the left wins over one upwards, as cancelling is asked first
        expect(outcomeOnRelease({ dx: -10, dy: -10 }, { x: -500, y: -500 })).toBe("cancel");
    });

    it("closes the lock over 105 of upward travel", () => {
        expect(locknessOf({ dx: 0, dy: 0 })).toBe(0);
        expect(locknessOf({ dx: 0, dy: -52.5 })).toBe(0.5);
        expect(locknessOf({ dx: 0, dy: -200 })).toBe(1);
    });

    it("shrinks the button towards 0.4 over 300 of leftward travel", () => {
        expect(scaleOf({ dx: 0, dy: 0 })).toBe(1);
        expect(scaleOf({ dx: -150, dy: 0 })).toBe(0.5);
        expect(scaleOf({ dx: -300, dy: 0 })).toBe(0.4);
    });

    it("tells the finger what letting go will do from 100 left and 60 up", () => {
        expect(feedbackOf({ dx: -100, dy: -60 })).toEqual({ cancel: false, lock: false });
        expect(feedbackOf({ dx: -101, dy: -61 })).toEqual({ cancel: true, lock: true });
    });

    it("measures speed over the last moments of the drag, not the whole of it", () => {
        expect(velocityOf([])).toEqual({ x: 0, y: 0 });
        expect(velocityOf([{ x: 5, y: 5, t: 0 }])).toEqual({ x: 0, y: 0 });
        const samples = [
            { x: 300, y: 600, t: 0 },
            { x: 300, y: 600, t: 900 }, // held still for a long time
            { x: 250, y: 600, t: 1000 }, // then 50px left in a tenth of a second
        ];
        expect(velocityOf(samples)).toEqual({ x: -500, y: 0 });
    });
});
