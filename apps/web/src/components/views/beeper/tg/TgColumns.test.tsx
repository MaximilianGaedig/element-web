/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, fireEvent, render, screen } from "test-utils-rtl";

import UIStore from "../../../../stores/UIStore";
import ResizeNotifier from "../../../../utils/ResizeNotifier";
import { TgColumns } from "./TgColumns";
import { TgBackButton } from "./TgNavigation";
import { STORAGE_KEY_LEFT } from "../../../../utils/beeper/tgLayout/constants";

function setViewport(width: number, height: number): void {
    UIStore.instance.windowWidth = width;
    UIStore.instance.windowHeight = height;
}

function renderColumns(): ReturnType<typeof render> {
    return render(
        <TgColumns
            spacePanel={<div>spaces</div>}
            leftPanel={<div>chat list</div>}
            resizeNotifier={new ResizeNotifier()}
        >
            <div>room</div>
        </TgColumns>,
    );
}

describe("TgColumns", () => {
    const initialWidth = UIStore.instance.windowWidth;
    const initialHeight = UIStore.instance.windowHeight;

    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        setViewport(initialWidth, initialHeight);
    });

    it("renders the docked layout with tweb's default width at 1440×900", () => {
        setViewport(1440, 900);
        const { container } = renderColumns();
        const root = container.querySelector<HTMLElement>(".mx_TgColumns")!;
        expect(root.dataset.screen).toBe("large");
        expect(root.style.getPropertyValue("--TgColumns-left-width")).toBe("360px");
        expect(screen.getByText("chat list")).toBeTruthy();
        expect(screen.getByText("room")).toBeTruthy();
        expect(screen.getByTestId("tg-resize-handle")).toBeTruthy();
    });

    it("restores a persisted width and the collapsed state", () => {
        setViewport(1440, 900);
        localStorage.setItem(STORAGE_KEY_LEFT, "420");
        const { container, unmount } = renderColumns();
        expect(
            container.querySelector<HTMLElement>(".mx_TgColumns")!.style.getPropertyValue("--TgColumns-left-width"),
        ).toBe("420px");
        unmount();

        localStorage.setItem(STORAGE_KEY_LEFT, "0");
        const { container: collapsed } = renderColumns();
        const root = collapsed.querySelector<HTMLElement>(".mx_TgColumns")!;
        expect(root.dataset.collapsed).toBe("true");
        expect(root.style.getPropertyValue("--TgColumns-left-width")).toBe("80px");
    });

    it("drags the edge, snaps to the avatars column below the threshold and persists", () => {
        setViewport(1440, 900);
        const { container } = renderColumns();
        const root = container.querySelector<HTMLElement>(".mx_TgColumns")!;
        const handle = screen.getByTestId("tg-resize-handle");

        fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 360 });
        expect(root.dataset.resizing).toBe("true");

        fireEvent.pointerMove(handle, { pointerId: 1, clientX: 400 });
        expect(root.style.getPropertyValue("--TgColumns-left-width")).toBe("400px");
        expect(root.dataset.collapsed).toBeUndefined();

        fireEvent.pointerMove(handle, { pointerId: 1, clientX: 150 });
        expect(root.dataset.collapsed).toBe("true");
        expect(root.style.getPropertyValue("--TgColumns-left-width")).toBe("80px");

        fireEvent.pointerUp(handle, { pointerId: 1, clientX: 150 });
        expect(root.dataset.resizing).toBeUndefined();
        expect(localStorage.getItem(STORAGE_KEY_LEFT)).toBe("0");
    });

    it("has no resize handle and ignores the collapsed preference in the floating range", () => {
        setViewport(800, 900);
        localStorage.setItem(STORAGE_KEY_LEFT, "0");
        const { container } = renderColumns();
        const root = container.querySelector<HTMLElement>(".mx_TgColumns")!;
        expect(root.dataset.screen).toBe("medium");
        expect(root.dataset.collapsed).toBeUndefined();
        expect(screen.queryByTestId("tg-resize-handle")).toBeNull();
    });

    describe("handhelds (390×844)", () => {
        function renderHandheld(chatOpen: boolean, onBack = vi.fn()): ReturnType<typeof render> {
            return render(
                <TgColumns
                    spacePanel={<div>spaces</div>}
                    leftPanel={<div>chat list</div>}
                    resizeNotifier={new ResizeNotifier()}
                    chatOpen={chatOpen}
                    chatKey="!room:example.org"
                    onBack={onBack}
                >
                    <div>
                        <TgBackButton />
                        room
                    </div>
                </TgColumns>,
            );
        }

        function touch(type: string, x: number, y: number): Event {
            const event = new Event(type, { bubbles: true, cancelable: true });
            Object.defineProperty(event, "touches", { value: type === "touchend" ? [] : [{ clientX: x, clientY: y }] });
            return event;
        }

        beforeEach(() => setViewport(390, 844));

        it("shows the chat list full screen when no chat is open, without a resize handle", () => {
            const { container } = renderHandheld(false);
            const root = container.querySelector<HTMLElement>(".mx_TgColumns")!;
            expect(root.dataset.screen).toBe("mobile");
            expect(root.dataset.chatShown).toBeUndefined();
            expect(screen.queryByTestId("tg-resize-handle")).toBeNull();
            expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
            expect(document.documentElement.getAttribute("data-tg-screen")).toBe("mobile");
        });

        it("slides the chat in, and back out before leaving it", () => {
            vi.useFakeTimers();
            try {
                const onBack = vi.fn();
                const { container } = renderHandheld(true, onBack);
                const root = container.querySelector<HTMLElement>(".mx_TgColumns")!;
                expect(root.dataset.chatShown).toBe("true");

                fireEvent.click(screen.getByRole("button", { name: "Back" }));
                expect(root.dataset.chatShown).toBeUndefined();
                expect(onBack).not.toHaveBeenCalled();
                act(() => void vi.advanceTimersByTime(200));
                expect(onBack).toHaveBeenCalledTimes(1);
            } finally {
                vi.useRealTimers();
            }
        });

        it("follows an edge swipe and goes back past 50px", () => {
            vi.useFakeTimers();
            try {
                const onBack = vi.fn();
                const { container } = renderHandheld(true, onBack);
                const root = container.querySelector<HTMLElement>(".mx_TgColumns")!;
                const center = container.querySelector<HTMLElement>(".mx_TgColumns_center")!;

                act(() => void center.dispatchEvent(touch("touchstart", 10, 400)));
                act(() => void center.dispatchEvent(touch("touchmove", 40, 402)));
                expect(root.dataset.swiping).toBe("true");
                expect(root.style.getPropertyValue("--TgColumns-swipe-dx")).toBe("30px");

                // Released before the threshold: snaps back.
                act(() => void center.dispatchEvent(touch("touchend", 40, 402)));
                expect(root.dataset.swiping).toBeUndefined();
                expect(root.dataset.chatShown).toBe("true");

                act(() => void center.dispatchEvent(touch("touchstart", 10, 400)));
                act(() => void center.dispatchEvent(touch("touchmove", 30, 401)));
                act(() => void center.dispatchEvent(touch("touchmove", 70, 401)));
                expect(root.dataset.chatShown).toBeUndefined();
                act(() => void vi.advanceTimersByTime(200));
                expect(onBack).toHaveBeenCalledTimes(1);
            } finally {
                vi.useRealTimers();
            }
        });

        it("ignores swipes that do not start at the edge", () => {
            const { container } = renderHandheld(true);
            const root = container.querySelector<HTMLElement>(".mx_TgColumns")!;
            const center = container.querySelector<HTMLElement>(".mx_TgColumns_center")!;
            act(() => void center.dispatchEvent(touch("touchstart", 120, 400)));
            act(() => void center.dispatchEvent(touch("touchmove", 300, 400)));
            expect(root.dataset.swiping).toBeUndefined();
            expect(root.dataset.chatShown).toBe("true");
        });
    });
});
