/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { TooltipProvider } from "@vector-im/compound-web";

import { RoomListItemView } from "./RoomListItem";
import type { RoomItemViewModel, RoomListItemSnapshot } from "./RoomListItem";
import { MockViewModel } from "../../viewmodel";

describe("<RoomListItemView />", () => {
    const onOpenRoom = jest.fn();
    const onMarkAsRead = jest.fn();
    const onMarkAsUnread = jest.fn();
    const onToggleFavorite = jest.fn();
    const onToggleLowPriority = jest.fn();
    const onInvite = jest.fn();
    const onCopyRoomLink = jest.fn();
    const onLeaveRoom = jest.fn();
    const onSetRoomNotifState = jest.fn();

    class RoomItemTestViewModel extends MockViewModel<RoomListItemSnapshot> implements RoomItemViewModel {
        public onOpenRoom = onOpenRoom;
        public onMarkAsRead = onMarkAsRead;
        public onMarkAsUnread = onMarkAsUnread;
        public onToggleFavorite = onToggleFavorite;
        public onToggleLowPriority = onToggleLowPriority;
        public onInvite = onInvite;
        public onCopyRoomLink = onCopyRoomLink;
        public onLeaveRoom = onLeaveRoom;
        public onSetRoomNotifState = onSetRoomNotifState;
        public getRoom = (): any => ({ roomId: "room1", name: "Test Room" });
    }

    let mockSnapshot: RoomListItemSnapshot;
    let mockViewModel: RoomItemViewModel;

    const mockAvatar = <div data-testid="mock-avatar">Avatar</div>;

    const renderRoomListItem = (
        props: Partial<React.ComponentProps<typeof RoomListItemView>> = {},
    ): ReturnType<typeof render> => {
        const defaultProps = {
            vm: mockViewModel,
            renderAvatar: () => mockAvatar,
            isSelected: false,
            isFocused: false,
            onFocus: jest.fn(),
            roomIndex: 0,
            roomCount: 1,
        };

        return render(<RoomListItemView {...defaultProps} {...props} />);
    };

    beforeEach(() => {
        jest.clearAllMocks();

        mockSnapshot = {
            id: "!room:server",
            room: { roomId: "!room:server" } as any,
            name: "Test Room",
            a11yLabel: "Open room Test Room",
            isBold: false,
            messagePreview: undefined,
            notification: {
                hasAnyNotificationOrActivity: false,
                isUnsentMessage: false,
                invited: false,
                isMention: false,
                isActivityNotification: false,
                isNotification: false,
                count: 0,
                muted: false,
            },
            showMoreOptionsMenu: false,
            showNotificationMenu: false,
            moreOptionsState: {} as any,
            notificationState: {} as any,
        };

        mockViewModel = new RoomItemTestViewModel(mockSnapshot);
    });

    it("should render a room item", () => {
        renderRoomListItem();
        expect(screen.getByRole("option", { name: "Open room Test Room" })).toBeInTheDocument();
        expect(screen.getByText("Test Room")).toBeInTheDocument();
        expect(screen.getByTestId("mock-avatar")).toBeInTheDocument();
    });

    it("should render with message preview", () => {
        mockSnapshot.messagePreview = "The message looks like this";
        mockViewModel = new RoomItemTestViewModel(mockSnapshot);
        renderRoomListItem();

        expect(screen.getByText("The message looks like this")).toBeInTheDocument();
    });

    it("should call onOpenRoom when clicked", async () => {
        const user = userEvent.setup();
        renderRoomListItem();

        await user.click(screen.getByRole("option", { name: "Open room Test Room" }));
        expect(onOpenRoom).toHaveBeenCalled();
    });

    it("should be selected if isSelected=true", () => {
        renderRoomListItem({ isSelected: true });

        expect(screen.getByRole("option", { name: "Open room Test Room" })).toHaveAttribute("aria-selected", "true");
    });

    it("should not be selected if isSelected=false", () => {
        renderRoomListItem({ isSelected: false });

        expect(screen.getByRole("option", { name: "Open room Test Room" })).toHaveAttribute("aria-selected", "false");
    });

    it("should display notification decoration when showDecoration is true", () => {
        mockSnapshot.notification.hasAnyNotificationOrActivity = true;
        mockSnapshot.notification.isNotification = true;
        mockSnapshot.notification.count = 5;
        mockViewModel = new RoomItemTestViewModel(mockSnapshot);
        renderRoomListItem();

        expect(screen.getByTestId("notification-decoration")).toBeInTheDocument();
    });

    it("should hide notification decoration when showDecoration is false", () => {
        mockSnapshot.notification.hasAnyNotificationOrActivity = false;
        mockViewModel = new RoomItemTestViewModel(mockSnapshot);
        renderRoomListItem();

        expect(screen.queryByTestId("notification-decoration")).toBeNull();
    });

    it("should apply bold styling when isBold is true", () => {
        mockSnapshot.isBold = true;
        mockViewModel = new RoomItemTestViewModel(mockSnapshot);
        renderRoomListItem();

        const button = screen.getByRole("option", { name: "Open room Test Room" });
        // Check if button has a class containing "bold" (CSS module hashed name)
        const hasBoldClass = button.className.split(" ").some((cls) => cls.includes("bold"));
        expect(hasBoldClass).toBe(true);
    });

    it("should have correct tabIndex when focused", () => {
        renderRoomListItem({ isFocused: true });

        expect(screen.getByRole("option", { name: "Open room Test Room" })).toHaveAttribute("tabIndex", "0");
    });

    it("should have correct tabIndex when not focused", () => {
        renderRoomListItem({ isFocused: false });

        expect(screen.getByRole("option", { name: "Open room Test Room" })).toHaveAttribute("tabIndex", "-1");
    });

    it("should call onFocus when focused", () => {
        const onFocus = jest.fn();
        renderRoomListItem({ onFocus });

        const item = screen.getByRole("option", { name: "Open room Test Room" });
        item.focus();

        expect(onFocus).toHaveBeenCalled();
    });

    it("should set correct aria-posinset and aria-setsize", () => {
        renderRoomListItem({ roomIndex: 5, roomCount: 10 });

        const item = screen.getByRole("option", { name: "Open room Test Room" });
        expect(item).toHaveAttribute("aria-posinset", "6"); // index + 1
        expect(item).toHaveAttribute("aria-setsize", "10");
    });

    it("should handle hover menu visibility", async () => {
        mockSnapshot.showMoreOptionsMenu = false;
        mockViewModel = new RoomItemTestViewModel(mockSnapshot);

        const { rerender } = render(
            <TooltipProvider>
                <RoomListItemView
                    vm={mockViewModel}
                    renderAvatar={() => mockAvatar}
                    isSelected={false}
                    isFocused={false}
                    onFocus={jest.fn()}
                    roomIndex={0}
                    roomCount={1}
                />
            </TooltipProvider>,
        );
        expect(screen.queryByRole("button", { name: "More Options" })).toBeNull();

        // Simulate hover by updating the snapshot
        mockSnapshot.showMoreOptionsMenu = true;
        mockViewModel = new RoomItemTestViewModel(mockSnapshot);
        rerender(
            <TooltipProvider>
                <RoomListItemView
                    vm={mockViewModel}
                    renderAvatar={() => mockAvatar}
                    isSelected={false}
                    isFocused={false}
                    onFocus={jest.fn()}
                    roomIndex={0}
                    roomCount={1}
                />
            </TooltipProvider>,
        );

        expect(screen.getByRole("button", { name: "More Options" })).toBeInTheDocument();
    });
});
