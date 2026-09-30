/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { markEntities } from "./mark";
import { type Detected } from "./entities";

describe("marking what a message names, where it was written", () => {
    it("underlines the phrase and hands a press on it to the caller", () => {
        const body = document.createElement("div");
        body.textContent = "do jutra do 14:00 ok?";
        const when: Detected = {
            kind: "datetime",
            text: "jutra do 14:00",
            start: 3,
            end: 17,
            date: new Date(2026, 9, 1, 14),
            hasTime: true,
        };
        const pressed = vi.fn();
        expect(markEntities(body, [when], pressed)).toBe(1);

        const mark = body.querySelector<HTMLButtonElement>(".mx_DetectedMark")!;
        expect(mark.textContent).toBe("jutra do 14:00");
        // The words around it are left as they were.
        expect(body.textContent).toBe("do jutra do 14:00 ok?");
        mark.click();
        expect(pressed).toHaveBeenCalledWith(when, mark);
    });

    // With the chips gone, what a measurement comes to is on its mark.
    it("says what a measurement comes to on the mark itself", () => {
        const body = document.createElement("div");
        body.textContent = "it is 5 miles away";
        markEntities(body, [{ kind: "measure", text: "5 miles", start: 6, end: 13, converted: "8 km" }]);
        const mark = body.querySelector<HTMLElement>(".mx_DetectedMark")!;
        expect(mark.title).toBe("8 km");
        expect(mark.getAttribute("aria-label")).toBe("5 miles (8 km)");
    });
});
