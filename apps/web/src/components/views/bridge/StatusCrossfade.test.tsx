/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React from "react";
import { act, render } from "test-utils-rtl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StatusCrossfade } from "./LastSeen";

describe("StatusCrossfade", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("shows nothing when there is nothing to show", () => {
        const { container } = render(<StatusCrossfade items={[null, null]} />);
        expect(container).toBeEmptyDOMElement();
    });

    it("shows a single status as it is", () => {
        const { container } = render(<StatusCrossfade items={[<span key="a">online</span>, null]} />);
        expect(container.textContent).toBe("online");
        expect(container.querySelector(".mx_StatusCrossfade")).toBeNull();
    });

    it("takes turns between two statuses instead of replacing one", () => {
        const { container } = render(
            <StatusCrossfade items={[<span key="a">online</span>, <span key="b">importing history</span>]} />,
        );
        const active = (): string | null | undefined =>
            container.querySelector('.mx_StatusCrossfade_item[data-active="true"]')?.textContent;
        expect(active()).toBe("online");
        act(() => vi.advanceTimersByTime(4100));
        expect(active()).toBe("importing history");
        act(() => vi.advanceTimersByTime(4100));
        expect(active()).toBe("online");
        // both stay in the DOM so the fade has something to fade
        expect(container.querySelectorAll(".mx_StatusCrossfade_item")).toHaveLength(2);
    });
});
