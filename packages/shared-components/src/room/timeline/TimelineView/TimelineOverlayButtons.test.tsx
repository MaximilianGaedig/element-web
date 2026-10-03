/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React from "react";
import { render, screen, cleanup } from "@test-utils";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import styles from "./TimelineOverlayButtons.module.css";
import { TimelineOverlayButtons } from "./TimelineOverlayButtons";
import type { TimelineViewActions, TimelineViewSnapshot } from "./types";

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

// vi.fn() carries a constructable signature that trips assignability to the
// action method types, so cast the record of spies to the interface.
function makeActions(): TimelineViewActions {
    return {
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
    } as unknown as TimelineViewActions;
}

// The jump controls must be exposed to AT/keyboard (the overlay is not aria-hidden),
// so plain role queries (which exclude hidden elements) are expected to find them.
const button = (name: string): HTMLElement => screen.getByRole("button", { name });
const queryButton = (name: string): HTMLElement | null => screen.queryByRole("button", { name });

const JUMP_TO_BOTTOM = "Scroll to most recent messages";
const JUMP_READ_MARKER = "Scroll to first unread message.";
const MARK_ALL_READ = "Mark all as read";
const JUMP_TO_MENTION = "Scroll to next unread mention";
const JUMP_TO_REACTION = "Scroll to next unread reaction";

describe("<TimelineOverlayButtons />", () => {
    // The spacing tokens come from compound's stylesheet, which the tests do not load; without them the
    // corner offsets are invalid and the stack lands at the top left, where no position can be compared.
    let tokens: HTMLStyleElement;
    beforeEach(() => {
        tokens = document.createElement("style");
        tokens.textContent = ":root { --cpd-space-1x: 4px; --cpd-space-3x: 12px; --cpd-space-6x: 24px; }";
        document.head.appendChild(tokens);
    });
    afterEach(() => tokens.remove());

    // It shrinks away rather than vanishing, so it is still in the page while it is not offered.
    it("keeps the jump-to-bottom button in the page but out of reach while it is not offered", () => {
        const { container, rerender } = render(
            <TimelineOverlayButtons snapshot={baseSnapshot} vm={makeActions()} scrollNow={vi.fn()} />,
        );
        const button = container.querySelector(".mx_JumpToBottomButton")!;

        expect(button).toHaveAttribute("inert");
        expect(button).toHaveClass(styles.away);
        expect(button).not.toBeVisible();

        rerender(
            <TimelineOverlayButtons
                snapshot={{ ...baseSnapshot, isAtBottom: false }}
                vm={makeActions()}
                scrollNow={vi.fn()}
            />,
        );

        expect(container.querySelector(".mx_JumpToBottomButton")).toBe(button);
        expect(button).not.toHaveAttribute("inert");
        expect(button).not.toHaveClass(styles.away);
        expect(queryButton(JUMP_TO_BOTTOM)).toBeVisible();
    });

    it("renders no buttons at the live bottom with no read marker", () => {
        const actions = makeActions();
        render(<TimelineOverlayButtons snapshot={baseSnapshot} vm={actions} scrollNow={vi.fn()} />);

        expect(queryButton(JUMP_TO_BOTTOM)).toBeNull();
        expect(queryButton(JUMP_READ_MARKER)).toBeNull();
        expect(queryButton(MARK_ALL_READ)).toBeNull();
    });

    describe("jump-to-bottom button", () => {
        it("shows when not at the live end", () => {
            render(
                <TimelineOverlayButtons
                    snapshot={{ ...baseSnapshot, atLiveEnd: false }}
                    vm={makeActions()}
                    scrollNow={vi.fn()}
                />,
            );
            expect(button(JUMP_TO_BOTTOM)).toBeInTheDocument();
        });

        it("shows when at the live end but scrolled up off the bottom", () => {
            const { container } = render(
                <TimelineOverlayButtons
                    snapshot={{ ...baseSnapshot, atLiveEnd: true, isAtBottom: false }}
                    vm={makeActions()}
                    scrollNow={vi.fn()}
                />,
            );
            expect(button(JUMP_TO_BOTTOM)).toBeInTheDocument();
            // The Telegram layout uses the same stable class as legacy navigation controls.
            expect(container.querySelector(".mx_JumpToBottomButton")).not.toBeNull();
        });

        it("calls onJumpToLive with the imperative scroll handle when clicked", async () => {
            const user = userEvent.setup();
            const actions = makeActions();
            const scrollNow = vi.fn();
            render(
                <TimelineOverlayButtons
                    snapshot={{ ...baseSnapshot, isAtBottom: false }}
                    vm={actions}
                    scrollNow={scrollNow}
                />,
            );

            await user.click(button(JUMP_TO_BOTTOM));

            expect(actions.onJumpToLive).toHaveBeenCalledWith(scrollNow);
        });

        it("renders the unread badge count", () => {
            render(
                <TimelineOverlayButtons
                    snapshot={{ ...baseSnapshot, isAtBottom: false, numUnreadMessages: 7 }}
                    vm={makeActions()}
                    scrollNow={vi.fn()}
                />,
            );
            expect(screen.getByText("7")).toBeInTheDocument();
        });

        it("omits the badge when there are no unread messages", () => {
            render(
                <TimelineOverlayButtons
                    snapshot={{ ...baseSnapshot, isAtBottom: false, numUnreadMessages: 0 }}
                    vm={makeActions()}
                    scrollNow={vi.fn()}
                />,
            );
            expect(screen.queryByText("0")).toBeNull();
        });

        it("applies the highlight style when there are highlight messages", () => {
            const { container } = render(
                <TimelineOverlayButtons
                    snapshot={{ ...baseSnapshot, isAtBottom: false, numUnreadMessages: 1, hasHighlights: true }}
                    vm={makeActions()}
                    scrollNow={vi.fn()}
                />,
            );
            expect(container.querySelector('[class*="highlight"]')).not.toBeNull();
        });
    });

    describe("unread bar", () => {
        it("shows scroll-up and mark-as-read when the marker is above the viewport", () => {
            render(
                <TimelineOverlayButtons
                    snapshot={{ ...baseSnapshot, canJumpToReadMarker: "above" }}
                    vm={makeActions()}
                    scrollNow={vi.fn()}
                />,
            );
            expect(button(JUMP_READ_MARKER)).toBeInTheDocument();
            expect(button(MARK_ALL_READ)).toBeInTheDocument();
        });

        it("shows the bar when the marker is below the viewport", () => {
            render(
                <TimelineOverlayButtons
                    snapshot={{ ...baseSnapshot, canJumpToReadMarker: "below" }}
                    vm={makeActions()}
                    scrollNow={vi.fn()}
                />,
            );
            expect(button(JUMP_READ_MARKER)).toBeInTheDocument();
            expect(button(MARK_ALL_READ)).toBeInTheDocument();
        });

        it("calls onJumpToReadMarker with the scroll handle and onMarkAllAsRead on click", async () => {
            const user = userEvent.setup();
            const actions = makeActions();
            const scrollNow = vi.fn();
            render(
                <TimelineOverlayButtons
                    snapshot={{ ...baseSnapshot, canJumpToReadMarker: "above" }}
                    vm={actions}
                    scrollNow={scrollNow}
                />,
            );

            await user.click(button(JUMP_READ_MARKER));
            expect(actions.onJumpToReadMarker).toHaveBeenCalledWith(scrollNow);

            await user.click(button(MARK_ALL_READ));
            expect(actions.onMarkAllAsRead).toHaveBeenCalledTimes(1);
        });
    });

    describe("unread mention and reaction buttons", () => {
        const scrolledUp = { ...baseSnapshot, isAtBottom: false };

        it("offers neither while nothing of the kind is unseen", () => {
            const { container } = render(
                <TimelineOverlayButtons snapshot={scrolledUp} vm={makeActions()} scrollNow={vi.fn()} />,
            );

            expect(queryButton(JUMP_TO_MENTION)).toBeNull();
            expect(queryButton(JUMP_TO_REACTION)).toBeNull();
            // Still in the page, so they can grow in, but out of reach.
            expect(container.querySelector(".mx_JumpToMentionButton")).toHaveClass(styles.away);
            expect(container.querySelector(".mx_JumpToMentionButton")).toHaveAttribute("inert");
            expect(container.querySelector(".mx_JumpToReactionButton")).toHaveClass(styles.away);
        });

        it("shows each with its count, even at the bottom of the chat", () => {
            render(
                <TimelineOverlayButtons
                    snapshot={{ ...baseSnapshot, unreadMentions: 3, unreadReactions: 14 }}
                    vm={makeActions()}
                    scrollNow={vi.fn()}
                />,
            );

            expect(button(JUMP_TO_MENTION)).toBeVisible();
            expect(button(JUMP_TO_REACTION)).toBeVisible();
            expect(screen.getByText("3")).toBeInTheDocument();
            expect(screen.getByText("14")).toBeInTheDocument();
            // Scroll-down is not offered at the bottom: it does not stand in for the others.
            expect(queryButton(JUMP_TO_BOTTOM)).toBeNull();
        });

        it("jumps with the scroll handle when tapped", async () => {
            const user = userEvent.setup();
            const actions = makeActions();
            const scrollNow = vi.fn();
            render(
                <TimelineOverlayButtons
                    snapshot={{ ...scrolledUp, unreadMentions: 1, unreadReactions: 1 }}
                    vm={actions}
                    scrollNow={scrollNow}
                />,
            );

            await user.click(button(JUMP_TO_MENTION));
            expect(actions.onJumpToUnreadMention).toHaveBeenCalledWith(scrollNow);
            expect(actions.onJumpToUnreadReaction).not.toHaveBeenCalled();

            await user.click(button(JUMP_TO_REACTION));
            expect(actions.onJumpToUnreadReaction).toHaveBeenCalledWith(scrollNow);
        });

        // Telegram iOS: scroll down at the bottom, the mentions over it, the reactions over those.
        it("stacks scroll-down, mentions and reactions from the bottom up", () => {
            render(
                <div style={{ position: "relative", width: 300, height: 400 }}>
                    <TimelineOverlayButtons
                        snapshot={{ ...scrolledUp, unreadMentions: 1, unreadReactions: 1 }}
                        vm={makeActions()}
                        scrollNow={vi.fn()}
                    />
                </div>,
            );

            const down = button(JUMP_TO_BOTTOM).getBoundingClientRect();
            const mention = button(JUMP_TO_MENTION).getBoundingClientRect();
            const reaction = button(JUMP_TO_REACTION).getBoundingClientRect();

            expect(mention.bottom).toBeLessThanOrEqual(down.top + 1);
            expect(reaction.bottom).toBeLessThanOrEqual(mention.top + 1);
            // One column, flush on the right.
            expect(mention.right).toBeCloseTo(down.right, 0);
            expect(reaction.right).toBeCloseTo(down.right, 0);
        });

        it("lets a button that is not offered give up its place, so the ones above settle down", () => {
            render(
                <div style={{ position: "relative", width: 300, height: 400 }}>
                    <TimelineOverlayButtons
                        snapshot={{ ...baseSnapshot, unreadMentions: 1 }}
                        vm={makeActions()}
                        scrollNow={vi.fn()}
                    />
                </div>,
            );
            const atBottom = button(JUMP_TO_MENTION).getBoundingClientRect().bottom;

            // Scrolled up, scroll-down takes the lowest place and the mention button is over it.
            cleanup();
            render(
                <div style={{ position: "relative", width: 300, height: 400 }}>
                    <TimelineOverlayButtons
                        snapshot={{ ...baseSnapshot, isAtBottom: false, unreadMentions: 1 }}
                        vm={makeActions()}
                        scrollNow={vi.fn()}
                    />
                </div>,
            );

            expect(button(JUMP_TO_MENTION).getBoundingClientRect().bottom).toBeLessThan(atBottom);
        });
    });

    describe("alignment", () => {
        // The old timeline's stylesheet and the Telegram layout's both size the svg inside these buttons
        // too, and the old one pads it 7px 8px 7px 6px: the glyph sat a pixel off to one side and a
        // pixel high, by whichever of three rules the cascade happened to prefer.
        let style: HTMLStyleElement;
        beforeEach(() => {
            style = document.createElement("style");
            style.textContent = `
                .mx_JumpToBottomButton_scrollDown svg { height: inherit; width: inherit; box-sizing: border-box; padding: 7px 8px 7px 6px; }
                .mx_TopUnreadMessagesBar_scrollUp svg { width: 24px; height: 24px; padding: 6px; }
            `;
            document.head.appendChild(style);
        });
        afterEach(() => style.remove());

        const centreOf = (rect: DOMRect): [number, number] => [rect.left + rect.width / 2, rect.top + rect.height / 2];

        it.each([
            ["jump-to-bottom", JUMP_TO_BOTTOM, { isAtBottom: false }],
            ["unread mentions", JUMP_TO_MENTION, { unreadMentions: 1 }],
            ["unread reactions", JUMP_TO_REACTION, { unreadReactions: 1 }],
            ["jump to unread", JUMP_READ_MARKER, { canJumpToReadMarker: "above" as const }],
        ])("centres the icon of the %s button in its circle", (_name, label, patch) => {
            render(
                <div style={{ position: "relative", width: 300, height: 400 }}>
                    <TimelineOverlayButtons
                        snapshot={{ ...baseSnapshot, ...patch }}
                        vm={makeActions()}
                        scrollNow={vi.fn()}
                    />
                </div>,
            );
            const circle = button(label);
            const svg = circle.querySelector("svg")!;
            const [cx, cy] = centreOf(circle.getBoundingClientRect());
            const [ix, iy] = centreOf(svg.getBoundingClientRect());

            // The icon's own box is centred, and nothing inside it pushes the glyph off that centre: its
            // padding is what the old rule was shifting it by, and the glyphs are drawn centred in
            // their boxes.
            expect(ix).toBeCloseTo(cx, 1);
            expect(iy).toBeCloseTo(cy, 1);
            const padding = getComputedStyle(svg);
            expect([padding.paddingTop, padding.paddingRight, padding.paddingBottom, padding.paddingLeft]).toEqual([
                "0px",
                "0px",
                "0px",
                "0px",
            ]);
        });
    });

    it("keeps clear of what sits at the right edge of the timeline, by the width it declares", () => {
        const snapshot = { ...baseSnapshot, isAtBottom: false };
        const { rerender } = render(
            <div style={{ position: "relative", width: 300, height: 400 }}>
                <TimelineOverlayButtons snapshot={snapshot} vm={makeActions()} scrollNow={vi.fn()} />
            </div>,
        );
        const before = button(JUMP_TO_BOTTOM).getBoundingClientRect().right;

        rerender(
            <div
                style={
                    {
                        "position": "relative",
                        "width": 300,
                        "height": 400,
                        "--mx-timeline-scrubber-inset": "20px",
                    } as React.CSSProperties
                }
            >
                <TimelineOverlayButtons snapshot={snapshot} vm={makeActions()} scrollNow={vi.fn()} />
            </div>,
        );

        expect(button(JUMP_TO_BOTTOM).getBoundingClientRect().right).toBeCloseTo(before - 20, 0);
    });
});
