/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, it, expect } from "vitest";

import { getMenuReactions, positionMenu, REACTIONS_MAX_LENGTH, splitMenuReactions } from "./telegramMenu";

describe("getMenuReactions", () => {
    it("puts recent emoji first, then Telegram's defaults, without duplicates", () => {
        const reactions = getMenuReactions(["😂", "👍"]);
        expect(reactions.slice(0, 4)).toEqual(["😂", "👍", "👎", "❤️"]);
        expect(reactions.filter((r) => r === "👍")).toHaveLength(1);
    });

    it("offers exactly what a network allows", () => {
        expect(getMenuReactions(["😂"], ["👍", "❤️"])).toEqual(["👍", "❤️"]);
    });

    it("shows seven and a more button", () => {
        const { shown, hasMore } = splitMenuReactions(getMenuReactions([]));
        expect(shown).toHaveLength(REACTIONS_MAX_LENGTH);
        expect(hasMore).toBe(true);
        expect(splitMenuReactions(["👍", "❤️"]).hasMore).toBe(false);
    });
});

describe("positionMenu", () => {
    const menu = { width: 200, height: 300 };
    const win = { width: 1000, height: 800 };

    it("opens at the pointer towards the inline end on desktop", () => {
        expect(positionMenu({ x: 100, y: 100 }, menu, win)).toEqual({ left: 100, top: 100, className: "bottom-right" });
    });

    it("opens towards the inline start on mobile", () => {
        expect(positionMenu({ x: 300, y: 100 }, menu, win, { isMobile: true })).toEqual({
            left: 100,
            top: 100,
            className: "bottom-left",
        });
    });

    it("falls back to the window edge when it doesn't fit", () => {
        const pos = positionMenu({ x: 900, y: 700 }, menu, win);
        expect(pos).toEqual({ left: 1000 - 200 - 8, top: 800 - 300 - 8, className: "center-center" });
    });
});
