/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";

import { pinnedIndexForTimestamp } from "./pinnedScrollSync";

// Three pins, oldest first, as useSortedFetchedPinnedEvents returns them.
const pins = [100, 200, 300];

describe("pinnedIndexForTimestamp", () => {
    it("shows the pin a message was sent under", () => {
        expect(pinnedIndexForTimestamp(pins, 250)).toBe(1);
        expect(pinnedIndexForTimestamp(pins, 350)).toBe(2);
    });

    it("counts a message sent at the moment of a pin as under it", () => {
        expect(pinnedIndexForTimestamp(pins, 200)).toBe(1);
    });

    it("shows the first pin above everything older than all of them", () => {
        // Scrolling to the very top of a chat must leave a pin on the plate, not empty it.
        expect(pinnedIndexForTimestamp(pins, 50)).toBe(0);
    });

    it("stays on the newest pin at the bottom of the chat", () => {
        expect(pinnedIndexForTimestamp(pins, Number.MAX_SAFE_INTEGER)).toBe(2);
    });

    it("handles a single pin", () => {
        expect(pinnedIndexForTimestamp([100], 50)).toBe(0);
        expect(pinnedIndexForTimestamp([100], 150)).toBe(0);
    });
});
