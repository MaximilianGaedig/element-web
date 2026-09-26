/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, act } from "test-utils-rtl";

import { useStuck } from "./useStuck";

type Callback = (entries: Array<{ isIntersecting: boolean }>) => void;

let callback: Callback | undefined;
let observed: Element | undefined;
let disconnected = false;

function stubObserver(): { root: Element | Document | null } {
    const captured: { root: Element | Document | null } = { root: null };
    vi.stubGlobal(
        "IntersectionObserver",
        class {
            public constructor(cb: Callback, options?: { root?: Element | Document | null }) {
                callback = cb;
                captured.root = options?.root ?? null;
            }
            public observe(el: Element): void {
                observed = el;
            }
            public disconnect(): void {
                disconnected = true;
            }
        },
    );
    return captured;
}

function Bar(): React.JSX.Element {
    const [sentinel, stuck] = useStuck();
    return (
        <div data-testid="scroller" style={{ overflowY: "scroll" }}>
            <div ref={sentinel} data-testid="sentinel" />
            <div data-testid="bar" className={stuck ? "stuck" : "loose"} />
        </div>
    );
}

describe("useStuck", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        callback = undefined;
        observed = undefined;
        disconnected = false;
    });

    it("is stuck exactly when the sentinel has scrolled out of the scrolling box", () => {
        stubObserver();
        render(<Bar />);
        expect(screen.getByTestId("bar")).toHaveClass("loose");
        expect(observed).toBe(screen.getByTestId("sentinel"));

        // The sentinel has left the top: the bar is now holding the edge.
        act(() => callback!([{ isIntersecting: false }]));
        expect(screen.getByTestId("bar")).toHaveClass("stuck");

        // Scrolled back to the start: it is part of the list again.
        act(() => callback!([{ isIntersecting: true }]));
        expect(screen.getByTestId("bar")).toHaveClass("loose");
    });

    it("watches the scrolling ancestor, not the viewport", () => {
        const captured = stubObserver();
        render(<Bar />);
        expect(captured.root).toBe(screen.getByTestId("scroller"));
    });

    it("stops watching when it goes away", () => {
        stubObserver();
        const { unmount } = render(<Bar />);
        unmount();
        expect(disconnected).toBe(true);
    });

    it("leaves the bar in its ordinary form where IntersectionObserver is missing", () => {
        vi.stubGlobal("IntersectionObserver", undefined);
        render(<Bar />);
        expect(screen.getByTestId("bar")).toHaveClass("loose");
    });
});
