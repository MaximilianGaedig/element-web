/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

import { ladderDelays, LADDER_TRANSITION_MS, playLadder } from "./ladder";

function tileAt(top: number): HTMLElement {
    const tile = document.createElement("li");
    tile.dataset.testid = "event-tile";
    const line = document.createElement("div");
    line.dataset.testid = "event-tile-line";
    tile.append(line);
    tile.getBoundingClientRect = () => ({ top, bottom: top + 50 }) as DOMRect;
    return tile;
}

describe("tweb bubble ladder (bubbles.ts animateAsLadder)", () => {
    it("starts with the newest bubble at 4ms, then 40ms per older bubble", () => {
        expect(ladderDelays(4)).toEqual([4, 40, 80, 120]);
        expect(ladderDelays(0)).toEqual([]);
    });

    it("zoom-fades only the visible bubbles, newest first", () => {
        const list = document.createElement("ol");
        const tiles = [tileAt(-200), tileAt(100), tileAt(200), tileAt(300), tileAt(900)];
        list.append(...tiles);
        const animate = vi.fn();
        tiles.forEach((t) => ((t.firstElementChild as HTMLElement).animate = animate));

        const count = playLadder(list, { top: 0, bottom: 600 } as DOMRect);

        expect(count).toBe(3);
        expect(animate.mock.calls.map(([, opts]) => opts.delay)).toEqual([4, 40, 80]);
        const [keyframes, opts] = animate.mock.calls[0];
        expect(keyframes[0]).toEqual({ transform: "scale3d(.8, .8, 1)", opacity: 0 });
        expect(opts).toMatchObject({ duration: LADDER_TRANSITION_MS, easing: "cubic-bezier(.4, 0, .2, 1)" });
        // The newest visible bubble (top 300) goes first.
        expect(animate.mock.contexts[0]).toBe(tiles[3].firstElementChild);
    });
});
