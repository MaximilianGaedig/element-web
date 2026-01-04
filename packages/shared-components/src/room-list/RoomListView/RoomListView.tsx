/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX, type ReactNode } from "react";

import { useViewModel } from "../../useViewModel";
import { type ViewModel } from "../../viewmodel/ViewModel";
import { RoomListPrimaryFilters, type Filter } from "../RoomListPrimaryFilters";
import { RoomListLoadingSkeleton } from "./RoomListLoadingSkeleton";
import { RoomListEmptyState } from "./RoomListEmptyState";
import { RoomList, type RoomListViewState } from "../RoomList";
import { type RoomListItemSnapshot } from "../RoomListItem";

/**
 * Snapshot for the room list view
 */
export type RoomListSnapshot = {
    /** Whether the rooms are currently loading */
    isLoadingRooms: boolean;
    /** Whether the room list is empty */
    isRoomListEmpty: boolean;
    /** Array of filter data */
    filters: Filter[];
    /** Room list state */
    roomListState: RoomListViewState;
    /** Array of room IDs for virtualization */
    roomIds: string[];
    /** Optional description for the empty state */
    emptyStateDescription?: string;
    /** Optional action element for the empty state */
    emptyStateAction?: ReactNode;
    /** Whether the user can create rooms */
    canCreateRoom?: boolean;
};

/**
 * Actions interface for room list operations
 */
export interface RoomListViewActions {
    /** Called when a filter is toggled */
    onToggleFilter: (filter: Filter) => void;
    /** Called to create a new chat room */
    createChatRoom: () => void;
    /** Called to create a new room */
    createRoom: () => void;
    /** Get view model for a specific room (virtualization API) */
    getRoomItemViewModel: (roomId: string) => any;
    /** Called when the visible range changes (virtualization API) */
    updateVisibleRooms: (startIndex: number, endIndex: number) => void;
}

/**
 * The view model type for the room list view
 */
export type RoomListViewModel = ViewModel<RoomListSnapshot> & RoomListViewActions;

/**
 * Props for RoomListView component
 */
export interface RoomListViewProps {
    /** The view model containing all data and callbacks */
    vm: RoomListViewModel;
    /** Render function for room avatar */
    renderAvatar: (roomItem: RoomListItemSnapshot) => ReactNode;
}

/**
 * Room list view component that manages filters, loading states, empty states, and the room list.
 */
export const RoomListView: React.FC<RoomListViewProps> = ({ vm, renderAvatar }): JSX.Element => {
    const snapshot = useViewModel(vm);
    let listBody: ReactNode;

    if (snapshot.isLoadingRooms) {
        listBody = <RoomListLoadingSkeleton />;
    } else if (snapshot.isRoomListEmpty) {
        listBody = <RoomListEmptyState vm={vm} />;
    } else {
        listBody = <RoomList vm={vm} renderAvatar={renderAvatar} />;
    }

    return (
        <>
            <RoomListPrimaryFilters filters={snapshot.filters} onToggleFilter={vm.onToggleFilter} />
            {listBody}
        </>
    );
};
