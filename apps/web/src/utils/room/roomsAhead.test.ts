/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { ROOMS_AHEAD, mayPrepareRooms, roomsAhead, withAhead } from "./roomsAhead";

describe("rooms made ready ahead of being opened", () => {
    afterEach(() => {
        roomsAhead.clear();
        document.documentElement.removeAttribute("data-low-power");
    });

    it("holds the newest first, each once, and no more than the limit", () => {
        expect(withAhead([], "!a")).toEqual(["!a"]);
        expect(withAhead(["!a"], "!b")).toEqual(["!b", "!a"]);
        // Pointed at again: it moves to the front rather than being held twice.
        expect(withAhead(["!b", "!a"], "!a")).toEqual(["!a", "!b"]);
        // One more than fits: the one pointed at longest ago makes way.
        expect(withAhead(["!b", "!a"], "!c")).toEqual(["!c", "!b"]);
        expect(withAhead(["!b", "!a"], "!c")).toHaveLength(ROOMS_AHEAD);
    });

    it("tells whoever mounts them when the rooms change, and only then", () => {
        const told = vi.fn();
        const stop = roomsAhead.subscribe(told);

        roomsAhead.prepare("!a");
        expect(roomsAhead.list()).toEqual(["!a"]);
        expect(told).toHaveBeenCalledTimes(1);

        // Already the newest: nothing changed, nothing to render again.
        const before = roomsAhead.list();
        roomsAhead.prepare("!a");
        expect(roomsAhead.list()).toBe(before);
        expect(told).toHaveBeenCalledTimes(1);

        roomsAhead.forget("!a");
        expect(roomsAhead.list()).toEqual([]);
        expect(told).toHaveBeenCalledTimes(2);
        roomsAhead.forget("!never");
        expect(told).toHaveBeenCalledTimes(2);

        stop();
        roomsAhead.prepare("!b");
        expect(told).toHaveBeenCalledTimes(2);
    });

    it("does no work on a guess for a device that is saving power", () => {
        expect(mayPrepareRooms()).toBe(true);
        document.documentElement.setAttribute("data-low-power", "");
        expect(mayPrepareRooms()).toBe(false);
        roomsAhead.prepare("!a");
        expect(roomsAhead.list()).toEqual([]);
    });
});
