/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { RoomListPrimaryFilters } from "./RoomListPrimaryFilters";
import type { Filter, FilterId } from "./useVisibleFilters";

const meta: Meta<typeof RoomListPrimaryFilters> = {
    title: "Room List/RoomListPrimaryFilters",
    component: RoomListPrimaryFilters,
    tags: ["autodocs"],
    args: {
        onToggleFilter: () => {},
    },
};

export default meta;
type Story = StoryObj<typeof RoomListPrimaryFilters>;

// Mock filter data - simple presentation data only
const createFilters = (activeId?: FilterId): Filter[] => {
    const allFilters: FilterId[] = ["unread", "people", "rooms", "favourite", "mentions", "invites", "low_priority"];

    return allFilters.map((id) => ({
        id,
        active: id === activeId,
    }));
};

export const Default: Story = {
    args: {
        filters: createFilters(),
    },
};

export const PeopleSelected: Story = {
    args: {
        filters: createFilters("people"),
    },
};

export const FewFilters: Story = {
    args: {
        filters: [
            {
                id: "unread",
                active: true,
            },
            {
                id: "people",
                active: false,
            },
        ],
    },
};
