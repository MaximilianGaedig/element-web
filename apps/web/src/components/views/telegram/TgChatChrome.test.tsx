/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React, { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "test-utils-rtl";

import { TgChatChrome } from "./TgChatChrome";

/** A box at these coordinates, as getBoundingClientRect reports one. */
function rect(left: number, right: number, top: number, bottom: number): DOMRect {
    return { left, right, top, bottom, width: right - left, height: bottom - top, x: left, y: top } as DOMRect;
}

describe("TgChatChrome", () => {
    afterEach(() => vi.restoreAllMocks());

    /*
     * The corner buttons stood at the timeline's own right edge, well past the chat column the header and
     * composer float in: they line up with those instead, from these two insets.
     */
    it("says how far in from the right the header and the composer end", () => {
        const body = document.createElement("div");
        const header = document.createElement("div");
        header.className = "mx_RoomHeader";
        const composer = document.createElement("div");
        composer.className = "mx_MessageComposer";
        body.append(header, composer);
        document.body.append(body);
        // The room body spans 509-1499; the column inside it ends at 1352 (header) and 1370 (composer).
        vi.spyOn(body, "getBoundingClientRect").mockReturnValue(rect(509, 1499, 0, 1036));
        vi.spyOn(header, "getBoundingClientRect").mockReturnValue(rect(656, 1352, 16, 64));
        vi.spyOn(composer, "getBoundingClientRect").mockReturnValue(rect(638, 1370, 972, 1020));
        const ref = createRef<HTMLDivElement>();
        (ref as { current: HTMLDivElement }).current = body;

        render(<TgChatChrome body={ref} />);

        expect(body.style.getPropertyValue("--tg-header-inline-end")).toBe("147px");
        expect(body.style.getPropertyValue("--tg-composer-inline-end")).toBe("129px");
        body.remove();
    });
});
