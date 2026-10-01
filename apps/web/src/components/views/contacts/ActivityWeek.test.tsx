/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "test-utils-rtl";

import { ActivityWeek, level } from "./ActivityWeek";
import { type Week } from "../../../utils/contacts/activity";

const empty = (): number[][] => Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));

describe("<ActivityWeek />", () => {
    it("puts a share of days in five steps", () => {
        expect(level(0)).toBe(0);
        // Seen once in twelve weeks is still seen: the faintest step, not none.
        expect(level(0.01)).toBe(1);
        expect(level(0.5)).toBe(2);
        expect(level(0.75)).toBe(3);
        expect(level(1)).toBe(4);
    });

    it("draws every hour of the week, as strong as it is usual", () => {
        const seen = empty();
        seen[0][9] = 4;
        seen[6][23] = 1;
        const week: Week = { seen, onlineMs: empty(), days: [4, 4, 4, 4, 4, 4, 4], entries: 50 };

        const { container } = render(<ActivityWeek week={week} />);

        const cells = container.querySelectorAll<HTMLElement>(".mx_ActivityWeek_cell");
        expect(cells).toHaveLength(7 * 24);
        // Monday 9 is the tenth cell; Sunday 23 the last.
        expect(cells[9].dataset.level).toBe("4");
        expect(cells[7 * 24 - 1].dataset.level).toBe("1");
        expect(cells[10].dataset.level).toBe("0");
        expect(container.querySelectorAll(".mx_ActivityWeek_day")).toHaveLength(7);
    });
});
