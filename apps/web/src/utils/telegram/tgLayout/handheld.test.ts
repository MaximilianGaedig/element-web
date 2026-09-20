/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { beginSwipeBack, moveSwipeBack, shouldPreventScroll, swipeBlockedAt } from "./swipeBack";
import { computeVh, installViewportHeight, keyboardClosed, VH_PROPERTY, VIEWPORT_TOP_PROPERTY } from "./viewportHeight";
import { attachLongPressContextMenu, cancelContextMenuOpening } from "./longPress";

function touchEvent(type: string, x: number, y: number, count = 1): Event {
    const event = new Event(type, { bubbles: true, cancelable: true });
    const touch = { clientX: x, clientY: y, screenX: x, screenY: y };
    Object.defineProperty(event, "touches", { value: Array.from({ length: count }, () => touch) });
    return event;
}

describe("swipe back (tweb handleHorizontalSwipe / handleTabSwipe / isSwipingBackSafari)", () => {
    it("starts anywhere, like Telegram iOS", () => {
        expect(beginSwipeBack(29, 300)).not.toBeNull();
        expect(beginSwipeBack(200, 300)).not.toBeNull();
    });

    it("leaves horizontal drags to text fields and sideways scrollers", () => {
        const boundary = document.createElement("div");
        boundary.innerHTML = `<input id="field"><div id="strip" style="overflow-x:auto"><span id="item"></span></div><p id="text"></p>`;
        document.body.appendChild(boundary);
        const strip = boundary.querySelector("#strip")!;
        Object.defineProperty(strip, "scrollWidth", { value: 500 });
        Object.defineProperty(strip, "clientWidth", { value: 300 });
        expect(swipeBlockedAt(boundary.querySelector("#field"), boundary)).toBe(true);
        expect(swipeBlockedAt(boundary.querySelector("#item"), boundary)).toBe(true);
        expect(swipeBlockedAt(boundary.querySelector("#text"), boundary)).toBe(false);
        boundary.remove();
    });

    it("cancels when the finger travels more than 20px vertically before turning horizontal", () => {
        let s = beginSwipeBack(5, 300);
        s = moveSwipeBack(s, 8, 315);
        expect(s.phase).toBe("cancelled");

        s = beginSwipeBack(5, 300);
        s = moveSwipeBack(s, 6, 321);
        expect(s.phase).toBe("cancelled");
    });

    it("locks horizontal once |x| > |y|, then tolerates vertical drift", () => {
        let s = beginSwipeBack(5, 300);
        s = moveSwipeBack(s, 20, 305);
        expect(s.phase).toBe("horizontal");
        expect(shouldPreventScroll(s)).toBe(true);
        s = moveSwipeBack(s, 40, 330);
        expect(s.phase).toBe("horizontal");
        expect(s.dx).toBe(35);
    });

    it("navigates past 50px of rightward travel", () => {
        let s = beginSwipeBack(5, 300);
        s = moveSwipeBack(s, 30, 300);
        s = moveSwipeBack(s, 55, 302);
        expect(s.phase).toBe("horizontal");
        s = moveSwipeBack(s, 56, 302);
        expect(s.phase).toBe("committed");
    });

    it("does not navigate for a leftward swipe", () => {
        let s = beginSwipeBack(25, 300);
        s = moveSwipeBack(s, 0, 300);
        expect(s.phase).toBe("horizontal");
        expect(s.dx).toBe(0);
    });
});

describe("viewport height (tweb src/index.ts setVH)", () => {
    afterEach(() => {
        document.documentElement.style.removeProperty(VH_PROPERTY);
    });

    it("computes 1% of the height to two decimals", () => {
        expect(computeVh(844)).toBe(8.44);
        expect(computeVh(517.333)).toBe(5.17);
    });

    it("treats growth of more than 1vh on touch devices as the keyboard closing", () => {
        expect(keyboardClosed(undefined, 8.44, true)).toBe(false);
        expect(keyboardClosed(5.17, 8.44, true)).toBe(true);
        expect(keyboardClosed(8.0, 8.44, true)).toBe(false);
        expect(keyboardClosed(5.17, 8.44, false)).toBe(false);
    });

    it("writes --tg-vh from the visual viewport and follows its resizes", () => {
        const listeners: Record<string, () => void> = {};
        const visualViewport = {
            height: 844,
            addEventListener: (type: string, cb: () => void) => (listeners[type] = cb),
            removeEventListener: vi.fn(),
        };
        const win = { visualViewport, document, navigator: { maxTouchPoints: 0 } } as unknown as Window;
        const stop = installViewportHeight(win);
        expect(document.documentElement.style.getPropertyValue(VH_PROPERTY)).toBe("8.44px");
        visualViewport.height = 500;
        listeners.resize();
        expect(document.documentElement.style.getPropertyValue(VH_PROPERTY)).toBe("5px");
        stop();
        expect(document.documentElement.style.getPropertyValue(VH_PROPERTY)).toBe("");
    });
});

describe("the app follows a panned visual viewport while the keyboard is up", () => {
    it("writes where iOS panned the viewport, only while the keyboard is up", () => {
        const listeners: Record<string, () => void> = {};
        const visualViewport = {
            height: 844,
            offsetTop: 0,
            addEventListener: (type: string, cb: () => void) => (listeners[type] = cb),
            removeEventListener: vi.fn(),
        };
        const scrollTo = vi.fn();
        const win = {
            visualViewport,
            document,
            innerHeight: 844,
            scrollY: 12,
            scrollTo,
            navigator: { maxTouchPoints: 5 },
        } as unknown as Window;
        const stop = installViewportHeight(win);
        expect(document.documentElement.style.getPropertyValue(VIEWPORT_TOP_PROPERTY)).toBe("");

        // The keyboard opens and iOS pans the viewport up by 300px.
        visualViewport.height = 500;
        visualViewport.offsetTop = 300;
        listeners.scroll();
        expect(document.documentElement.style.getPropertyValue(VIEWPORT_TOP_PROPERTY)).toBe("300px");
        expect(scrollTo).toHaveBeenCalledWith(0, 0);

        // The keyboard closes.
        visualViewport.height = 844;
        visualViewport.offsetTop = 0;
        listeners.resize();
        expect(document.documentElement.style.getPropertyValue(VIEWPORT_TOP_PROPERTY)).toBe("");
        stop();
    });
});

describe("long press (tweb attachContextMenuListener)", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("opens the context menu after 400ms", () => {
        const el = document.createElement("div");
        const child = document.createElement("span");
        el.append(child);
        const onMenu = vi.fn((e: MouseEvent) => e.preventDefault());
        el.addEventListener("contextmenu", onMenu);
        const stop = attachLongPressContextMenu(el);

        child.dispatchEvent(touchEvent("touchstart", 50, 60));
        vi.advanceTimersByTime(399);
        expect(onMenu).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(onMenu).toHaveBeenCalledTimes(1);
        expect(onMenu.mock.calls[0][0].clientX).toBe(50);

        // The finger lifting right after must not reach the menu.
        const end = touchEvent("touchend", 50, 60, 0);
        child.dispatchEvent(end);
        expect(end.defaultPrevented).toBe(true);
        stop();
    });

    it("is cancelled by moving, lifting, a second finger or a swipe", () => {
        const el = document.createElement("div");
        const onMenu = vi.fn();
        el.addEventListener("contextmenu", onMenu);
        const stop = attachLongPressContextMenu(el);

        el.dispatchEvent(touchEvent("touchstart", 1, 1));
        el.dispatchEvent(touchEvent("touchmove", 2, 2));
        vi.advanceTimersByTime(500);

        el.dispatchEvent(touchEvent("touchstart", 1, 1));
        el.dispatchEvent(touchEvent("touchend", 1, 1, 0));
        vi.advanceTimersByTime(500);

        el.dispatchEvent(touchEvent("touchstart", 1, 1, 2));
        vi.advanceTimersByTime(500);

        el.dispatchEvent(touchEvent("touchstart", 1, 1));
        cancelContextMenuOpening();
        vi.advanceTimersByTime(400);

        expect(onMenu).not.toHaveBeenCalled();
        stop();
    });
});
