/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { act } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import { RoomListPrimaryFilters } from "./RoomListPrimaryFilters";
import type { Filter } from "./useVisibleFilters";

describe("<RoomListPrimaryFilters />", () => {
    const filterToggleMocks = [jest.fn(), jest.fn(), jest.fn()];
    let filters: Filter[];
    let resizeCallback: ResizeObserverCallback;

    beforeEach(() => {
        // Reset mocks between tests
        filterToggleMocks.forEach((mock) => mock.mockClear());

        // Mock ResizeObserver
        global.ResizeObserver = jest.fn().mockImplementation((callback) => {
            resizeCallback = callback;
            return {
                observe: jest.fn(),
                unobserve: jest.fn(),
                disconnect: jest.fn(),
            };
        });

        filters = [
            { id: "people", active: true },
            { id: "rooms", active: false },
            { id: "unread", active: false },
        ];
    });

    function mockFiltersOffsetLeft(): void {
        // Mock offsetLeft for filters to simulate layout
        const peopleFilter = screen.getByText("People");
        const roomsFilter = screen.getByText("Rooms");
        const unreadFilter = screen.getByText("Unreads");

        jest.spyOn(peopleFilter, "offsetLeft", "get").mockReturnValue(0);
        jest.spyOn(roomsFilter, "offsetLeft", "get").mockReturnValue(30);
        jest.spyOn(unreadFilter, "offsetLeft", "get").mockReturnValue(60);

        // Trigger resize observer
        const listbox = screen.getByRole("listbox", { name: "Room list filters" });
        act(() => resizeCallback([{ target: listbox } as any], {} as ResizeObserver));
    }

    function makeUnreadWrapping(): void {
        const peopleFilter = screen.getByText("People");
        const roomsFilter = screen.getByText("Rooms");
        const unreadFilter = screen.getByText("Unreads");

        jest.spyOn(peopleFilter, "offsetLeft", "get").mockReturnValue(0);
        jest.spyOn(roomsFilter, "offsetLeft", "get").mockReturnValue(30);
        // Unreads is wrapping - has offsetLeft of 0 (new line)
        jest.spyOn(unreadFilter, "offsetLeft", "get").mockReturnValue(0);

        const listbox = screen.getByRole("listbox", { name: "Room list filters" });
        act(() => resizeCallback([{ target: listbox } as any], {} as ResizeObserver));
    }

    it("should render all filters correctly", () => {
        const onToggle = jest.fn();
        render(<RoomListPrimaryFilters filters={filters} onToggleFilter={onToggle} />);
        mockFiltersOffsetLeft();

        // Check that all filters are rendered
        expect(screen.getByRole("option", { name: "People" })).toBeInTheDocument();
        expect(screen.getByRole("option", { name: "Rooms" })).toBeInTheDocument();
        expect(screen.getByRole("option", { name: "Unreads" })).toBeInTheDocument();

        // Check that the active filter is marked as selected
        expect(screen.getByRole("option", { name: "People" })).toHaveAttribute("aria-selected", "true");
        expect(screen.getByRole("option", { name: "Rooms" })).toHaveAttribute("aria-selected", "false");
        expect(screen.getByRole("option", { name: "Unreads" })).toHaveAttribute("aria-selected", "false");
    });

    it("should call toggle function when a filter is clicked", async () => {
        const user = userEvent.setup();
        const onToggle = jest.fn();
        render(<RoomListPrimaryFilters filters={filters} onToggleFilter={onToggle} />);
        mockFiltersOffsetLeft();

        // Click on an inactive filter
        await user.click(screen.getByRole("option", { name: "Rooms" }));

        // Check that the toggle function was called
        expect(onToggle).toHaveBeenCalledTimes(1);
        expect(onToggle).toHaveBeenCalledWith(filters[1]);
    });

    it("should toggle active filter when clicked", async () => {
        const user = userEvent.setup();
        const onToggle = jest.fn();
        render(<RoomListPrimaryFilters filters={filters} onToggleFilter={onToggle} />);
        mockFiltersOffsetLeft();

        // Click on the active filter
        await user.click(screen.getByRole("option", { name: "People" }));

        // Check that the toggle function was called
        expect(onToggle).toHaveBeenCalledTimes(1);
        expect(onToggle).toHaveBeenCalledWith(filters[0]);
    });

    it("should hide filters if they are wrapping", async () => {
        const onToggle = jest.fn();
        render(<RoomListPrimaryFilters filters={filters} onToggleFilter={onToggle} />);
        mockFiltersOffsetLeft();

        // No filter is wrapping, so chevron shouldn't be visible
        expect(screen.queryByRole("button", { name: "Expand filter list" })).toBeNull();
        expect(screen.getByRole("option", { name: "Unreads" })).toBeVisible();

        makeUnreadWrapping();

        // The Unreads filter is wrapping, it should not be visible when collapsed
        expect(screen.queryByRole("option", { name: "Unreads" })).toBeNull();
        // Now filters are wrapping, so chevron should be visible
        expect(screen.getByRole("button", { name: "Expand filter list" })).toBeInTheDocument();
    });

    it("should expand and collapse filter list with chevron button", async () => {
        const user = userEvent.setup();
        const onToggle = jest.fn();
        render(<RoomListPrimaryFilters filters={filters} onToggleFilter={onToggle} />);
        makeUnreadWrapping();

        // Initially collapsed, Unreads should not be visible
        expect(screen.queryByRole("option", { name: "Unreads" })).toBeNull();

        // Click expand button
        await user.click(screen.getByRole("button", { name: "Expand filter list" }));

        // The list is expanded, so Unreads should be visible
        expect(screen.getByRole("option", { name: "Unreads" })).toBeVisible();
        expect(screen.getByRole("button", { name: "Collapse filter list" })).toBeInTheDocument();

        // Click collapse button
        await user.click(screen.getByRole("button", { name: "Collapse filter list" }));

        // Unreads should be hidden again
        expect(screen.queryByRole("option", { name: "Unreads" })).toBeNull();
    });

    it("should move the active filter to front when collapsed and wrapping", async () => {
        const onToggle = jest.fn();
        const filtersWithUnreadActive: Filter[] = [
            { id: "people", active: false },
            { id: "rooms", active: false },
            { id: "unread", active: true },
        ];

        render(<RoomListPrimaryFilters filters={filtersWithUnreadActive} onToggleFilter={onToggle} />);
        makeUnreadWrapping();

        const listbox = screen.getByRole("listbox", { name: "Room list filters" });

        // When collapsed with wrapping, active filter (Unreads) should be moved to first position
        expect(listbox.children[0]).toBe(screen.getByRole("option", { name: "Unreads" }));
    });

    it("should restore original filter order when expanded", async () => {
        const user = userEvent.setup();
        const onToggle = jest.fn();
        const filtersWithUnreadActive: Filter[] = [
            { id: "people", active: false },
            { id: "rooms", active: false },
            { id: "unread", active: true },
        ];

        render(<RoomListPrimaryFilters filters={filtersWithUnreadActive} onToggleFilter={onToggle} />);
        makeUnreadWrapping();

        const listbox = screen.getByRole("listbox", { name: "Room list filters" });

        // Initially collapsed - active filter at front
        expect(listbox.children[0]).toBe(screen.getByRole("option", { name: "Unreads" }));

        // Expand the list
        await user.click(screen.getByRole("button", { name: "Expand filter list" }));

        // When expanded, filters should be in original order (Unreads should not be first)
        expect(listbox.children[0]).not.toBe(screen.getByRole("option", { name: "Unreads" }));
        expect(listbox.children[0]).toBe(screen.getByRole("option", { name: "People" }));
    });

    it("should handle resize events correctly", () => {
        const onToggle = jest.fn();
        render(<RoomListPrimaryFilters filters={filters} onToggleFilter={onToggle} />);

        // Initially set up as non-wrapping
        mockFiltersOffsetLeft();
        expect(screen.queryByRole("button", { name: "Expand filter list" })).toBeNull();

        // Simulate window resize that causes wrapping
        makeUnreadWrapping();
        expect(screen.getByRole("button", { name: "Expand filter list" })).toBeInTheDocument();
    });

    it("should render with no filters", () => {
        const onToggle = jest.fn();
        render(<RoomListPrimaryFilters filters={[]} onToggleFilter={onToggle} />);

        expect(screen.getByRole("listbox", { name: "Room list filters" })).toBeInTheDocument();
        expect(screen.queryByRole("option")).toBeNull();
    });
});
