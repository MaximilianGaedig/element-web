/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React from "react";
import { render, screen, waitFor } from "@test-utils";
import userEvent from "@testing-library/user-event";
import { composeStories } from "@storybook/react-vite";
import { describe, it, expect } from "vitest";

import * as stories from "./RoomListItemView.stories";

const {
    Default,
    Selected,
    WithNotification,
    WithMention,
    WithVoiceCall,
    WithVideoCall,
    Invitation,
    UnsentMessage,
    NoMessagePreview,
    WithHoverMenu,
    WithoutHoverMenu,
} = composeStories(stories);

describe("<RoomListItemView />", () => {
    it("renders Default story", () => {
        const { container } = render(<Default />);
        expect(container).toMatchSnapshot();
    });

    it("renders Selected story", () => {
        const { container } = render(<Selected />);
        expect(container).toMatchSnapshot();
    });

    it("renders WithNotification story", () => {
        const { container } = render(<WithNotification />);
        expect(container).toMatchSnapshot();
    });

    it("renders WithMention story", () => {
        const { container } = render(<WithMention />);
        expect(container).toMatchSnapshot();
    });

    it("renders WithVoiceCall story", () => {
        const { container } = render(<WithVoiceCall />);
        expect(container).toMatchSnapshot();
    });

    it("renders WithVideoCall story", () => {
        const { container } = render(<WithVideoCall />);
        expect(container).toMatchSnapshot();
    });

    it("renders Invitation story", () => {
        const { container } = render(<Invitation />);
        expect(container).toMatchSnapshot();
    });

    it("renders UnsentMessage story", () => {
        const { container } = render(<UnsentMessage />);
        expect(container).toMatchSnapshot();
    });

    it("renders NoMessagePreview story", () => {
        const { container } = render(<NoMessagePreview />);
        expect(container).toMatchSnapshot();
    });

    it("renders WithHoverMenu story", () => {
        const { container } = render(<WithHoverMenu />);
        expect(container).toMatchSnapshot();
    });

    it("should call onOpenRoom when clicked", async () => {
        const user = userEvent.setup();
        render(<Default />);

        await user.click(screen.getByRole("option"));
        expect(Default.args.onOpenRoom).toHaveBeenCalled();
    });

    it("should have aria-selected true when selected", () => {
        render(<Selected />);
        expect(screen.getByRole("option")).toHaveAttribute("aria-selected", "true");
    });

    it("should have aria-selected false when not selected", () => {
        render(<Default />);
        expect(screen.getByRole("option")).toHaveAttribute("aria-selected", "false");
    });

    it("should have tabIndex -1 when not focused", () => {
        render(<Default />);
        expect(screen.getByRole("option")).toHaveAttribute("tabIndex", "-1");
    });

    it("should call onFocus when focused", () => {
        render(<Default />);
        screen.getByRole("option").focus();
        expect(Default.args.onFocus).toHaveBeenCalled();
    });

    it("should display notification decoration when present", () => {
        render(<WithNotification />);
        expect(screen.getByTestId("notification-decoration")).toBeInTheDocument();
    });

    it("should hide notification decoration when not present", () => {
        render(<Default />);
        expect(screen.queryByTestId("notification-decoration")).toBeNull();
    });

    it("should show hover menu when showMoreOptionsMenu is true", () => {
        const { container } = render(<WithHoverMenu />);
        expect(container.querySelector('[aria-label="More Options"]')).not.toBeNull();
    });

    it("marks a thumbnail of the replied-to photo with a reply arrow", () => {
        const { container } = render(
            <Default messagePreviewThumbnail="https://example.org/thumb.png" messagePreviewThumbnailIsReply={true} />,
        );
        expect(container.querySelector("img")).not.toBeNull();
        expect(screen.getByTestId("preview-reply-icon")).toBeInTheDocument();
    });

    it("shows a message's own photo without a reply arrow", () => {
        const { container } = render(<Default messagePreviewThumbnail="https://example.org/thumb.png" />);
        expect(container.querySelector("img")).not.toBeNull();
        expect(screen.queryByTestId("preview-reply-icon")).toBeNull();
    });

    it("loads its pictures as soon as the row renders, not once it scrolls into view", () => {
        // The list renders rows ahead of the scroll inside a clipping scroll box, where a lazy image only starts
        // loading once its row is on screen and shows nothing until then.
        const { container } = render(<Default messagePreviewThumbnail="https://example.org/thumb.png" />);
        const images = [...container.querySelectorAll("img")];
        expect(images.length).toBeGreaterThan(0);
        for (const img of images) expect(img).not.toHaveAttribute("loading");
    });

    it("should hide hover menu when showMoreOptionsMenu is false", () => {
        const { container } = render(<WithoutHoverMenu />);
        expect(container.querySelector('[aria-label="More Options"]')).toBeNull();
    });

    it("reveals the hover menu on keyboard focus and clears it when focus leaves", async () => {
        // isFocused focuses the row via the keyboard on mount, so the hover menu is revealed.
        const { container } = render(<WithHoverMenu isFocused={true} />);
        const option = screen.getByRole("option");
        const moreButton = container.querySelector('[aria-label="More Options"]');

        expect(option.className).toMatch(/keyboardActive/);
        expect(moreButton).toBeVisible();

        // Focus leaving the row hides the menu again.
        option.blur();
        await waitFor(() => expect(option.className).not.toMatch(/keyboardActive/));
        // ...unless the pointer is resting on the row, which shows it too: these tests run in a real
        // browser, and an earlier one can have left the pointer where this row is drawn.
        if (!option.matches(":hover")) expect(moreButton).not.toBeVisible();
    });

    // The unread decoration is the only thing telling an unread room from a read one, as in Telegram.
    it("styles an unread room's row exactly like a read one's, apart from the decoration", () => {
        const classesOf = (root: HTMLElement): string[] =>
            [root, ...root.querySelectorAll<HTMLElement>("*")]
                .filter((el) => !el.closest('[data-testid="notification-decoration"]'))
                .map((el) => `${el.tagName}.${el.getAttribute("class") ?? ""}`);

        const look = (el: HTMLElement): string => {
            const style = getComputedStyle(el);
            return `${style.fontWeight} ${style.color}`;
        };

        const read = render(<WithNotification notification={Default.args.notification!} />);
        const readClasses = classesOf(read.getByRole("option"));
        const readName = look(read.getByTestId("room-name"));
        read.unmount();

        const unread = render(<WithNotification />);
        expect(screen.getByTestId("notification-decoration")).toBeInTheDocument();
        expect(classesOf(unread.getByRole("option"))).toEqual(readClasses);
        expect(look(unread.getByTestId("room-name"))).toBe(readName);
    });

    // The time ends the name line; the ticks sit on the message line, in front of the unread badge, as in Telegram.
    it("puts the time at the end of the name line and our last message's ticks on the message line", () => {
        render(
            <WithNotification
                lastActivity="12:30"
                messagePreviewSendState="read"
                renderSendState={(state) => <span data-testid="ticks">{state}</span>}
            />,
        );
        const ticks = screen.getByTestId("room-send-state");
        expect(ticks).toContainElement(screen.getByTestId("ticks"));
        expect(screen.getByTestId("ticks")).toHaveTextContent("read");

        const name = screen.getByTestId("room-name").getBoundingClientRect();
        const time = screen.getByTestId("room-time").getBoundingClientRect();
        const row = screen.getByRole("option").getBoundingClientRect();
        const ticksBox = ticks.getBoundingClientRect();
        const badge = screen.getByTestId("notification-decoration").getBoundingClientRect();

        // Name line: the time is on the name's line, after it, and not on the message line.
        expect(time.top).toBeLessThan(name.bottom);
        expect(time.left).toBeGreaterThanOrEqual(name.right);
        // Message line: below the name, ticks left of the badge, the badge nearer the row's right edge.
        expect(ticksBox.top).toBeGreaterThanOrEqual(name.bottom);
        expect(ticksBox.right).toBeLessThanOrEqual(badge.left);
        expect(badge.right).toBeLessThanOrEqual(row.right);
    });

    it("draws who has read somebody else's message, which has no ticks", () => {
        render(
            <Default
                messagePreviewReaders={["@alice:server"]}
                renderSendState={(state, readers) => <span data-testid="readers">{`${state}:${readers?.join()}`}</span>}
            />,
        );
        expect(screen.getByTestId("room-send-state")).toContainElement(screen.getByTestId("readers"));
        expect(screen.getByTestId("readers")).toHaveTextContent("undefined:@alice:server");
    });

    it("shows no ticks when the last message is not ours", () => {
        render(<Default renderSendState={(state) => <span>{state}</span>} />);
        expect(screen.queryByTestId("room-send-state")).toBeNull();
    });
});
