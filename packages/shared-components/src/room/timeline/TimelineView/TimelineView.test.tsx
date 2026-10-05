/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React from "react";
import { act, render, screen, waitFor, type RenderResult } from "@test-utils";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, it, expect, vi } from "vitest";

import { TimelineView } from "./TimelineView";
import styles from "./TimelineView.module.css";
import type { TimelineItem, TimelineViewModel, TimelineViewSnapshot } from "./types";

const baseSnapshot: TimelineViewSnapshot = {
    items: [],
    atLiveEnd: true,
    pendingAnchor: null,
    highlightedEventId: null,
    isAtBottom: true,
    canJumpToReadMarker: false,
    numUnreadMessages: 0,
    hasHighlights: false,
    unreadMentions: 0,
    unreadReactions: 0,
};

function eventItems(count: number, offset = 0): TimelineItem[] {
    return Array.from({ length: count }, (_, i) => ({
        key: `evt-${offset + i}`,
        kind: "event" as const,
        continuation: false,
        lastInSection: true,
    }));
}

type Actions = {
    onStartReached: ReturnType<typeof vi.fn>;
    onEndReached: ReturnType<typeof vi.fn>;
    onAnchorReached: ReturnType<typeof vi.fn>;
    onVisibleRangeChanged: ReturnType<typeof vi.fn>;
    onAtBottomStateChange: ReturnType<typeof vi.fn>;
    onJumpToReadMarker: ReturnType<typeof vi.fn>;
    onMarkAllAsRead: ReturnType<typeof vi.fn>;
    onJumpToLive: ReturnType<typeof vi.fn>;
    onJumpToUnreadMention: ReturnType<typeof vi.fn>;
    onJumpToUnreadReaction: ReturnType<typeof vi.fn>;
};

interface FakeVm {
    vm: TimelineViewModel;
    actions: Actions;
    /** Push a new snapshot and notify subscribers (wrapped in act). */
    update: (patch: Partial<TimelineViewSnapshot>) => void;
}

function makeFakeVm(initial: Partial<TimelineViewSnapshot> = {}): FakeVm {
    let snapshot: TimelineViewSnapshot = { ...baseSnapshot, ...initial };
    const listeners = new Set<() => void>();
    const actions: Actions = {
        onStartReached: vi.fn(),
        onEndReached: vi.fn(),
        onAnchorReached: vi.fn(),
        onVisibleRangeChanged: vi.fn(),
        onAtBottomStateChange: vi.fn(),
        onJumpToReadMarker: vi.fn(),
        onMarkAllAsRead: vi.fn(),
        onJumpToLive: vi.fn(),
        onJumpToUnreadMention: vi.fn(),
        onJumpToUnreadReaction: vi.fn(),
    };
    // vi.fn() carries a constructable signature that trips assignability to the
    // ViewModel's action method types, so cast the assembled object.
    const vm = {
        getSnapshot: () => snapshot,
        subscribe: (listener: () => void) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        ...actions,
    } as unknown as TimelineViewModel;
    const update = (patch: Partial<TimelineViewSnapshot>): void => {
        act(() => {
            snapshot = { ...snapshot, ...patch };
            listeners.forEach((l) => l());
        });
    };
    return { vm, actions, update };
}

// Each row is a fixed 40px so the virtualizer measures a deterministic layout.
const ROW_HEIGHT = 40;
const renderItem = (item: TimelineItem): React.ReactNode => (
    <div data-testid={`row-${item.key}`} style={{ height: ROW_HEIGHT }}>
        {item.key}
    </div>
);

const DAY_ONE = Date.UTC(2026, 0, 1);
const DAY_TWO = Date.UTC(2026, 0, 2);
/** Two days of messages, each introduced by its own date separator. */
function twoDayItems(): TimelineItem[] {
    return [
        { key: "sep-1", kind: "date-separator" as const, ts: DAY_ONE },
        ...eventItems(20),
        { key: "sep-2", kind: "date-separator" as const, ts: DAY_TWO },
        ...eventItems(20, 20),
    ];
}
const renderStickyDate = (ts: number): React.ReactNode => <div data-testid="sticky-date">{String(ts)}</div>;

// Fixed-height viewport: the TimelineView is height:100%, so its parent must size it.
const VIEWPORT_HEIGHT = 300;
function renderTimeline(vm: TimelineViewModel, alwaysShowStickyDate = false, animateNewMessages = false): RenderResult {
    return render(
        <div style={{ height: VIEWPORT_HEIGHT, width: 320 }}>
            <TimelineView
                vm={vm}
                renderItem={renderItem}
                renderStickyDate={renderStickyDate}
                alwaysShowStickyDate={alwaysShowStickyDate}
                animateNewMessages={animateNewMessages}
            />
        </div>,
    );
}

/**
 * Scrolls the list as a reader would, and waits until the list has been told: a scroll event is
 * delivered with the next frame, and what the view does afterwards depends on having had it.
 */
async function scrollTo(scroller: HTMLElement, top: number): Promise<void> {
    const delivered = new Promise<void>((resolve) =>
        scroller.addEventListener("scroll", () => resolve(), { once: true }),
    );
    act(() => {
        scroller.scrollTop = top;
    });
    await delivered;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

describe("<TimelineView />", () => {
    it("renders each item via the renderItem callback", async () => {
        const { vm } = makeFakeVm({ items: eventItems(5) });
        renderTimeline(vm);

        expect(await screen.findByTestId("row-evt-0")).toBeInTheDocument();
        expect(screen.getByTestId("row-evt-4")).toBeInTheDocument();
    });

    it("stays hidden behind the cover then reveals after the anchor settles", async () => {
        // A list taller than the viewport so there is a real scroll offset to settle on.
        const { vm, actions } = makeFakeVm({ items: eventItems(30) });
        renderTimeline(vm);

        const scroller = screen.getByTestId("timeline-scroller");
        // Cover is up initially: the scroller is hidden and the anchor hasn't settled.
        expect(scroller).toHaveStyle({ visibility: "hidden" });
        expect(actions.onAnchorReached).not.toHaveBeenCalled();

        await waitFor(() => expect(actions.onAnchorReached).toHaveBeenCalledTimes(1), { timeout: 5000 });
        await waitFor(() => expect(scroller).toHaveStyle({ visibility: "visible" }));
    });

    // Placing the first rows takes a frame or two; a spinner flashed for that long made switching chats
    // look like loading them.
    it("shows no spinner while the first rows are being placed", () => {
        const { vm } = makeFakeVm({ items: eventItems(30) });
        const { container } = renderTimeline(vm);

        const cover = container.querySelector(`.${styles.cover}`);
        expect(cover).not.toBeNull();
        expect(cover).toBeEmptyDOMElement();
    });

    it("reports the visible range and at-bottom state once live", async () => {
        const { vm, actions } = makeFakeVm({ items: eventItems(30) });
        renderTimeline(vm);

        await waitFor(() => expect(actions.onAnchorReached).toHaveBeenCalled(), { timeout: 5000 });
        await waitFor(() => expect(actions.onVisibleRangeChanged).toHaveBeenCalled());
        await waitFor(() => expect(actions.onAtBottomStateChange).toHaveBeenCalled());

        // Indices are 0-based into the items array.
        const [start, end] = actions.onVisibleRangeChanged.mock.calls.at(-1)!;
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeGreaterThan(start);
    });

    // Nothing moves after a list that fits the window is placed; without this report the view model never
    // learns what is on screen, and nothing in it is ever read (MEO-44, the Stream's read receipts).
    it("reports what is on screen once placed, when nothing moves afterwards", async () => {
        const { vm, actions, update } = makeFakeVm({
            items: eventItems(5),
            pendingAnchor: { targetKey: "evt-4", align: "end" },
        });
        actions.onAnchorReached.mockImplementation(() => update({ pendingAnchor: null }));
        renderTimeline(vm);

        await waitFor(() => expect(actions.onAnchorReached).toHaveBeenCalled(), { timeout: 5000 });
        await waitFor(() => expect(actions.onVisibleRangeChanged).toHaveBeenCalledWith(0, 4, 4));
    });

    it("re-renders when the view model pushes a new snapshot", async () => {
        const { vm, update } = makeFakeVm({ items: eventItems(5) });
        renderTimeline(vm);
        await screen.findByTestId("row-evt-0");

        update({ items: eventItems(6) });

        expect(await screen.findByTestId("row-evt-5")).toBeInTheDocument();
    });

    it("shows the jump-to-bottom control once revealed when scrolled off the bottom", async () => {
        const { vm, actions } = makeFakeVm({ items: eventItems(30), isAtBottom: false });
        renderTimeline(vm);

        const jumpToBottom = await screen.findByRole(
            "button",
            { name: "Scroll to most recent messages" },
            { timeout: 5000 },
        );

        const user = userEvent.setup();
        await user.click(jumpToBottom);
        expect(actions.onJumpToLive).toHaveBeenCalledTimes(1);
        // The View hands the VM its imperative scroll handle.
        expect(actions.onJumpToLive.mock.calls[0][0]).toBeTypeOf("function");
    });

    it("says which message the reader has reached the end of, short of anything floating over the list", async () => {
        const { vm, actions } = makeFakeVm({ items: eventItems(30) });
        // 100px at the end of the list is behind something, as a composer would be
        render(
            <div style={{ height: VIEWPORT_HEIGHT, width: 320 }}>
                <TimelineView vm={vm} renderItem={renderItem} paddingEnd={100} />
            </div>,
        );
        const scroller = screen.getByTestId("timeline-scroller");
        await waitFor(() => expect(actions.onAnchorReached).toHaveBeenCalled(), { timeout: 5000 });
        // At the end, the last row sits just above that: it is the one read to its end
        await waitFor(() => expect(actions.onVisibleRangeChanged.mock.calls.at(-1)?.[2]).toBe(29));

        // Half a row up, the last row's end is behind it: the one before is
        act(() => {
            scroller.scrollTop -= ROW_HEIGHT / 2;
        });
        await waitFor(() => expect(actions.onVisibleRangeChanged.mock.calls.at(-1)?.[2]).toBe(28));
    });

    it("shows the embedder's placeholder, not a spinner, when placing the first rows is slow", async () => {
        // No rows: nothing to place, so the cover stays up and turns slow
        const { vm } = makeFakeVm({ items: [] });
        const { container } = render(
            <div style={{ height: VIEWPORT_HEIGHT, width: 320 }}>
                <TimelineView
                    vm={vm}
                    renderItem={renderItem}
                    renderPlaceholder={() => <div data-testid="placeholder" />}
                />
            </div>,
        );

        expect(await screen.findByTestId("placeholder", undefined, { timeout: 3000 })).toBeInTheDocument();
        expect(container.querySelector(`.${styles.cover}`)?.children).toHaveLength(1);
    });

    /* A chat with nothing to show never had rows to place, so it spun for good. */
    it("says the chat is empty, without a spinner or placeholder, once there is nothing to show", async () => {
        const { vm, update } = makeFakeVm({ items: [] });
        const { container } = render(
            <div style={{ height: VIEWPORT_HEIGHT, width: 320 }}>
                <TimelineView
                    vm={vm}
                    renderItem={renderItem}
                    renderPlaceholder={() => <div data-testid="placeholder" />}
                    renderEmpty={() => <div data-testid="empty" />}
                />
            </div>,
        );

        update({ items: [], isEmpty: true });

        expect(await screen.findByTestId("empty")).toBeInTheDocument();
        await new Promise((resolve) => setTimeout(resolve, 1500));
        expect(screen.queryByTestId("placeholder")).toBeNull();
        expect(container.querySelector(`.${styles.cover}`)?.children).toHaveLength(1);
    });

    describe("the list changing height, as a phone's keyboard coming up does", () => {
        const endOf = (scroller: HTMLElement): number => scroller.scrollHeight - scroller.clientHeight;
        const Timeline = ({ vm, height }: { vm: TimelineViewModel; height: number }): React.ReactNode => (
            <div style={{ height, width: 320 }}>
                <TimelineView vm={vm} renderItem={renderItem} />
            </div>
        );

        it("keeps a reader at the end at the end", async () => {
            const { vm, actions } = makeFakeVm({ items: eventItems(30) });
            const { rerender } = render(<Timeline vm={vm} height={VIEWPORT_HEIGHT} />);
            const scroller = screen.getByTestId("timeline-scroller");
            await waitFor(() => expect(actions.onAnchorReached).toHaveBeenCalled(), { timeout: 5000 });
            await waitFor(() => expect(scroller.scrollTop).toBeCloseTo(endOf(scroller), 0));
            const before = scroller.scrollTop;

            // The keyboard takes 120px off the bottom
            rerender(<Timeline vm={vm} height={VIEWPORT_HEIGHT - 120} />);

            await waitFor(() => expect(scroller.scrollTop).toBeCloseTo(before + 120, 0));
            expect(scroller.scrollTop).toBeCloseTo(endOf(scroller), 0);

            // ...and gives it back
            rerender(<Timeline vm={vm} height={VIEWPORT_HEIGHT} />);
            await waitFor(() => expect(scroller.scrollTop).toBeCloseTo(before, 0));
        });

        it("leaves a reader who has scrolled up where they are", async () => {
            const { vm, actions } = makeFakeVm({ items: eventItems(30) });
            const { rerender } = render(<Timeline vm={vm} height={VIEWPORT_HEIGHT} />);
            const scroller = screen.getByTestId("timeline-scroller");
            await waitFor(() => expect(actions.onAnchorReached).toHaveBeenCalled(), { timeout: 5000 });
            await scrollTo(scroller, 100);
            await waitFor(() => expect(actions.onAtBottomStateChange).toHaveBeenLastCalledWith(false));

            rerender(<Timeline vm={vm} height={VIEWPORT_HEIGHT - 120} />);
            await new Promise((resolve) => setTimeout(resolve, 100));

            expect(scroller.scrollTop).toBe(100);
        });
    });

    // A chat switched away from stays mounted but is not laid out; what arrives meanwhile is never measured.
    describe("coming back on screen", () => {
        const TALL = 120;
        const tallRow = (item: TimelineItem): React.ReactNode => (
            <div data-testid={`row-${item.key}`} style={{ height: item.key.startsWith("new") ? TALL : ROW_HEIGHT }}>
                {item.key}
            </div>
        );
        const Timeline = ({ vm, away }: { vm: TimelineViewModel; away: boolean }): React.ReactNode => (
            <div style={{ height: VIEWPORT_HEIGHT, width: 320, contentVisibility: away ? "hidden" : "visible" }}>
                <TimelineView vm={vm} renderItem={tallRow} />
            </div>
        );
        const newRows = (count: number): TimelineItem[] =>
            eventItems(count).map((item, i) => ({ ...item, key: `new-${i}` }));

        it("settles on the newest message, though the ones that came while away were never measured", async () => {
            const { vm, actions, update } = makeFakeVm({ items: eventItems(30) });
            const { rerender } = render(<Timeline vm={vm} away={false} />);
            const scroller = screen.getByTestId("timeline-scroller");
            await waitFor(() => expect(actions.onAnchorReached).toHaveBeenCalled(), { timeout: 5000 });
            await scrollTo(scroller, 100);

            // Away, while eight tall messages arrive
            rerender(<Timeline vm={vm} away={true} />);
            const items = [...eventItems(30), ...newRows(8)];
            update({ items });
            actions.onAnchorReached.mockClear();

            // Back, asked to settle at the newest
            rerender(<Timeline vm={vm} away={false} />);
            update({ pendingAnchor: { targetKey: "new-7", align: "end", settle: true } });

            await waitFor(() => expect(actions.onAnchorReached).toHaveBeenCalled(), { timeout: 5000 });
            expect(scroller.scrollTop).toBeCloseTo(scroller.scrollHeight - scroller.clientHeight, 0);
            expect(screen.getByTestId("row-new-7")).toBeVisible();
        });
    });

    describe("the space kept clear at the end changing, as a composer growing does", () => {
        const endOf = (scroller: HTMLElement): number => scroller.scrollHeight - scroller.clientHeight;
        const Timeline = ({ vm, paddingEnd }: { vm: TimelineViewModel; paddingEnd: number }): React.ReactNode => (
            <div style={{ height: VIEWPORT_HEIGHT, width: 320 }}>
                <TimelineView vm={vm} renderItem={renderItem} paddingEnd={paddingEnd} />
            </div>
        );

        it("keeps a reader at the end at the end", async () => {
            const { vm, actions } = makeFakeVm({ items: eventItems(30) });
            const { rerender } = render(<Timeline vm={vm} paddingEnd={60} />);
            const scroller = screen.getByTestId("timeline-scroller");
            await waitFor(() => expect(actions.onAnchorReached).toHaveBeenCalled(), { timeout: 5000 });
            await waitFor(() => expect(scroller.scrollTop).toBeCloseTo(endOf(scroller), 0));
            const before = scroller.scrollTop;

            // A reply is quoted above the composer: 48px more is covered
            rerender(<Timeline vm={vm} paddingEnd={108} />);

            expect(scroller.scrollTop).toBeCloseTo(before + 48, 0);
            expect(scroller.scrollTop).toBeCloseTo(endOf(scroller), 0);

            // ...and back, when it is sent
            rerender(<Timeline vm={vm} paddingEnd={60} />);
            await waitFor(() => expect(scroller.scrollTop).toBeCloseTo(before, 0));
            expect(scroller.scrollTop).toBeCloseTo(endOf(scroller), 0);
        });

        it("leaves a reader who has scrolled up where they are", async () => {
            const { vm, actions } = makeFakeVm({ items: eventItems(30) });
            const { rerender } = render(<Timeline vm={vm} paddingEnd={60} />);
            const scroller = screen.getByTestId("timeline-scroller");
            await waitFor(() => expect(actions.onAnchorReached).toHaveBeenCalled(), { timeout: 5000 });
            await scrollTo(scroller, 100);
            await waitFor(() => expect(actions.onAtBottomStateChange).toHaveBeenLastCalledWith(false));

            rerender(<Timeline vm={vm} paddingEnd={108} />);

            expect(scroller.scrollTop).toBe(100);
        });
    });

    describe("a new message at the live end", () => {
        const endOf = (scroller: HTMLElement): number => scroller.scrollHeight - scroller.clientHeight;
        const rowOf = (key: string): HTMLElement => screen.getByTestId(`row-${key}`).closest("li")!;

        afterEach(() => {
            vi.restoreAllMocks();
        });

        /**
         * A timeline of 30 messages, shown and resting at its end. The browser these tests run in asks
         * for reduced motion, which turns the animation off: `motion` says whether this reader does.
         */
        async function atTheEnd(
            animateNewMessages: boolean,
            motion = true,
        ): Promise<FakeVm & { scroller: HTMLElement }> {
            if (motion) {
                const matchMedia = window.matchMedia.bind(window);
                vi.spyOn(window, "matchMedia").mockImplementation((query) =>
                    query.includes("prefers-reduced-motion")
                        ? ({ matches: false, media: query } as MediaQueryList)
                        : matchMedia(query),
                );
            }
            const fake = makeFakeVm({ items: eventItems(30) });
            renderTimeline(fake.vm, false, animateNewMessages);
            const scroller = screen.getByTestId("timeline-scroller");
            await waitFor(() => expect(fake.actions.onAnchorReached).toHaveBeenCalled(), { timeout: 5000 });
            await waitFor(() => expect(fake.actions.onAtBottomStateChange).toHaveBeenLastCalledWith(true));
            expect(endOf(scroller)).toBeGreaterThan(0);
            expect(scroller.scrollTop).toBeCloseTo(endOf(scroller), 0);
            return { ...fake, scroller };
        }

        it("is added below the end and scrolled into view, not jumped to", async () => {
            const { scroller, update, actions } = await atTheEnd(true);
            const before = scroller.scrollTop;
            actions.onAtBottomStateChange.mockClear();

            update({ items: eventItems(31) });

            // Added, marked for the embedder to animate, and still out of sight below the end
            expect(rowOf("evt-30")).toHaveAttribute("data-just-added", "true");
            expect(scroller.scrollTop).toBe(before);
            expect(endOf(scroller)).toBeGreaterThan(before);

            // ...on the way: past where it was, not yet at the end
            await waitFor(() => {
                expect(scroller.scrollTop).toBeGreaterThan(before);
                expect(scroller.scrollTop).toBeLessThan(endOf(scroller));
            });
            // ...and there, with the mark gone again
            await waitFor(() => expect(scroller.scrollTop).toBeCloseTo(endOf(scroller), 0));
            await waitFor(() => expect(rowOf("evt-30")).not.toHaveAttribute("data-just-added"));
            // The reader never left the live end as far as the view model is told
            expect(actions.onAtBottomStateChange).not.toHaveBeenCalledWith(false);
        });

        it("follows a second message that arrives during the first one's reveal", async () => {
            const { scroller, update } = await atTheEnd(true);
            const before = scroller.scrollTop;

            update({ items: eventItems(31) });
            await waitFor(() => expect(scroller.scrollTop).toBeGreaterThan(before));
            update({ items: eventItems(32) });

            expect(rowOf("evt-31")).toHaveAttribute("data-just-added", "true");
            await waitFor(() => expect(scroller.scrollTop).toBeCloseTo(endOf(scroller), 0));
            expect(endOf(scroller)).toBeCloseTo(before + 2 * ROW_HEIGHT, 0);
        });

        it("leaves a reader who has scrolled up where they are", async () => {
            const { scroller, update, actions } = await atTheEnd(true);
            await scrollTo(scroller, 100);
            await waitFor(() => expect(actions.onAtBottomStateChange).toHaveBeenLastCalledWith(false));

            update({ items: eventItems(31) });
            await new Promise((resolve) => setTimeout(resolve, 400));

            expect(scroller.scrollTop).toBe(100);
            expect(scroller.querySelector("[data-just-added]")).toBeNull();
        });

        it("is handed back to a reader who scrolls during the reveal", async () => {
            const { scroller, update } = await atTheEnd(true);
            const before = scroller.scrollTop;

            update({ items: eventItems(31) });
            await waitFor(() => expect(scroller.scrollTop).toBeGreaterThan(before));
            scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -10 }));
            const stoppedAt = scroller.scrollTop;
            await new Promise((resolve) => setTimeout(resolve, 300));

            expect(scroller.scrollTop).toBe(stoppedAt);
            expect(stoppedAt).toBeLessThan(endOf(scroller));
        });

        it("is jumped to, unmarked, for a reader who asked for reduced motion", async () => {
            const { scroller, update } = await atTheEnd(true, false);

            update({ items: eventItems(31) });

            await waitFor(() => expect(scroller.scrollTop).toBeCloseTo(endOf(scroller), 0));
            expect(scroller.scrollTop).toBeGreaterThan(0);
            expect(scroller.querySelector("[data-just-added]")).toBeNull();
        });

        it("is jumped to, unmarked, when new messages are not animated", async () => {
            const { scroller, update } = await atTheEnd(false);

            update({ items: eventItems(31) });

            await waitFor(() => expect(scroller.scrollTop).toBeCloseTo(endOf(scroller), 0));
            expect(scroller.scrollTop).toBeGreaterThan(0);
            expect(scroller.querySelector("[data-just-added]")).toBeNull();
        });
    });

    describe("the floating date", () => {
        /** The floating date's wrapper, which carries the class that shows or hides it. */
        function floatingDate(): HTMLElement {
            return screen.getByTestId("sticky-date").parentElement!;
        }

        it("names the day the topmost visible message belongs to, and only while scrolling", async () => {
            const { vm, actions } = makeFakeVm({ items: twoDayItems() });
            renderTimeline(vm);
            await waitFor(() => expect(actions.onAnchorReached).toHaveBeenCalled(), { timeout: 5000 });

            // Starts at the newest message, so the second day's separator is above the
            // viewport and that is the day being read.
            await waitFor(() => expect(screen.getByTestId("sticky-date")).toHaveTextContent(String(DAY_TWO)));
            // Nothing has moved yet, so it is not shown.
            expect(floatingDate()).not.toHaveClass(styles.stickyDateVisible);

            const scroller = screen.getByTestId("timeline-scroller");
            act(() => {
                scroller.scrollTop = scroller.scrollHeight;
                scroller.dispatchEvent(new Event("scroll"));
            });
            await waitFor(() => expect(floatingDate()).toHaveClass(styles.stickyDateVisible));
        });

        it("stays on screen without scrolling when asked to (Telegram's pinned date)", async () => {
            const { vm, actions } = makeFakeVm({ items: twoDayItems() });
            renderTimeline(vm, true);
            await waitFor(() => expect(actions.onAnchorReached).toHaveBeenCalled(), { timeout: 5000 });

            const scroller = screen.getByTestId("timeline-scroller");
            act(() => {
                scroller.scrollTop = scroller.scrollHeight;
                scroller.dispatchEvent(new Event("scroll"));
            });
            await waitFor(() => expect(screen.getByTestId("sticky-date")).toHaveTextContent(String(DAY_TWO)));
            // Long after the last scroll it is still there (the plain one goes after SCROLL_IDLE_MS).
            await new Promise((resolve) => setTimeout(resolve, 1600));
            expect(floatingDate()).toHaveClass(styles.stickyDateVisible);
        });

        it("is pushed up by the next day's separator rather than swapped for it", async () => {
            const { vm, actions } = makeFakeVm({ items: twoDayItems() });
            renderTimeline(vm, true);
            await waitFor(() => expect(actions.onAnchorReached).toHaveBeenCalled(), { timeout: 5000 });
            const scroller = screen.getByTestId("timeline-scroller");
            // Day two's separator is row 21; stop with it 4px below the top, inside the pinned date.
            act(() => {
                scroller.scrollTop = 21 * ROW_HEIGHT - 4;
                scroller.dispatchEvent(new Event("scroll"));
            });
            await waitFor(() => expect(screen.getByTestId("sticky-date")).toHaveTextContent(String(DAY_ONE)));
            await waitFor(() => expect(floatingDate().style.transform).toMatch(/translateY\(-\d+(\.\d+)?px\)/));
        });

        it("says nothing while the day's own separator is still on screen", async () => {
            // One day, few enough messages that its separator stays in view.
            const { vm, actions } = makeFakeVm({
                items: [{ key: "sep-1", kind: "date-separator", ts: DAY_ONE }, ...eventItems(3)],
            });
            renderTimeline(vm);
            await waitFor(() => expect(actions.onAnchorReached).toHaveBeenCalled(), { timeout: 5000 });

            const scroller = screen.getByTestId("timeline-scroller");
            act(() => {
                scroller.dispatchEvent(new Event("scroll"));
            });
            // Either nothing is rendered at all, or it is rendered but not shown — both mean
            // the same date is never on screen twice.
            const rendered = screen.queryByTestId("sticky-date");
            if (rendered) expect(rendered.parentElement!).not.toHaveClass(styles.stickyDateVisible);
        });
    });
    // History is asked for while the reader is still a couple of screens away from the top of what is
    // loaded, so it is there when they arrive rather than loading once they have hit the end.
    it("asks for earlier history before the reader reaches the top", async () => {
        const { vm, actions } = makeFakeVm({ items: eventItems(150) });
        render(
            <div style={{ height: 600, width: 320 }}>
                <TimelineView vm={vm} renderItem={renderItem} />
            </div>,
        );
        const scroller = screen.getByTestId("timeline-scroller");
        await waitFor(() => expect(actions.onAnchorReached).toHaveBeenCalled(), { timeout: 5000 });
        // At the end, far from the top: nothing asked.
        expect(actions.onStartReached).not.toHaveBeenCalled();

        // Under two screens (1200px) from it, though the first row is still far from being drawn.
        await scrollTo(scroller, 1100);
        await waitFor(() => expect(actions.onStartReached).toHaveBeenCalled());
    });

    // As in Telegram iOS: a jump glides to its target rather than cutting to it.
    it("glides to where a jump goes", async () => {
        // Motion as a reader without reduced motion has it.
        const matchMedia = window.matchMedia.bind(window);
        vi.spyOn(window, "matchMedia").mockImplementation((query: string) =>
            query.includes("prefers-reduced-motion") ? ({ matches: false } as MediaQueryList) : matchMedia(query),
        );
        const { vm, actions } = makeFakeVm({ items: eventItems(30), isAtBottom: false });
        renderTimeline(vm);
        const scroller = screen.getByTestId("timeline-scroller");
        await waitFor(() => expect(actions.onAnchorReached).toHaveBeenCalled(), { timeout: 5000 });
        await waitFor(() => expect(scroller.scrollTop).toBeGreaterThan(500));
        const before = scroller.scrollTop;

        const jumpToBottom = await screen.findByRole("button", { name: "Scroll to most recent messages" });
        await userEvent.setup().click(jumpToBottom);
        const scrollNow = actions.onJumpToLive.mock.calls[0][0] as (anchor: {
            targetKey: string;
            align: string;
        }) => void;
        act(() => scrollNow({ targetKey: vm.getSnapshot().items[0].key, align: "start" }));

        // Not there at once (a far jump cuts to two screens short of it and glides the rest)...
        expect(scroller.scrollTop).toBeGreaterThan(0);
        expect(scroller.scrollTop).toBeLessThan(before);
        // ...but soon after.
        await waitFor(() => expect(scroller.scrollTop).toBe(0), { timeout: 1000 });
    });
});
