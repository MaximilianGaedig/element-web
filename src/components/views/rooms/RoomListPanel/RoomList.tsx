/*
 * Copyright 2025 New Vector Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { useCallback, useRef, type JSX, useMemo } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";
import { isEqual } from "lodash";

import { type RoomListViewState } from "../../../viewmodels/roomlist/RoomListViewModel";
import { _t } from "../../../../languageHandler";
import { RoomListItemView } from "./RoomListItemView";
import { type ListContext, ListView, type ScrollIntoViewOnChange } from "../../../utils/ListView";
import { type FilterKey } from "../../../../stores/room-list-v3/skip-list/filters";
import { getKeyBindingsManager } from "../../../../KeyBindingsManager";
import { KeyBindingAction } from "../../../../accessibility/KeyboardShortcuts";
import { Landmark, LandmarkNavigation } from "../../../../accessibility/LandmarkNavigation";
import SettingsStore from "../../../../settings/SettingsStore";

interface RoomListProps {
    /**
     * The view model state for the room list.
     */
    vm: RoomListViewState;
}

type Context = {
    spaceId: string;
    filterKeys: FilterKey[] | undefined;
};

/**
 * Height of a single room list item
 */
const ROOM_LIST_ITEM_HEIGHT = 48;

/**
 * A virtualized list of rooms.
 */
export function RoomList({ vm: { roomsResult, activeIndex } }: RoomListProps): JSX.Element {
    const lastSpaceId = useRef<string | undefined>(undefined);
    const lastFilterKeys = useRef<FilterKey[] | undefined>(undefined);
    const roomCount = roomsResult.rooms.length;

    const itemHeight = useMemo(() => {
        let height = ROOM_LIST_ITEM_HEIGHT;
        const showPath = SettingsStore.getValue("RoomList.showSpacePath");
        if (showPath === "under") {
            height += 12;
        }
        return height;
    }, []);

    const extendedViewportHeight = 25 * itemHeight;

    const getItemComponent = useCallback(
        (
            index: number,
            item: Room,
            context: ListContext<Context>,
            onFocus: (item: Room, e: React.FocusEvent) => void,
        ): JSX.Element => {
            const itemKey = item.roomId;
            const isRovingItem = itemKey === context.tabIndexKey;
            const isFocused = isRovingItem && context.focused;
            const isSelected = activeIndex === index;
            return (
                <RoomListItemView
                    room={item}
                    key={itemKey}
                    isSelected={isSelected}
                    isFocused={isFocused}
                    tabIndex={isRovingItem ? 0 : -1}
                    roomIndex={index}
                    roomCount={roomCount}
                    onFocus={onFocus}
                />
            );
        },
        [activeIndex, roomCount],
    );

    const getItemKey = useCallback((item: Room): string => {
        return item.roomId;
    }, []);

    const scrollIntoViewOnChange = useCallback<ScrollIntoViewOnChange<Room, Context>>(
        (params) => {
            const { spaceId, filterKeys } = params.context.context;
            const shouldScrollIndexIntoView =
                lastSpaceId.current !== spaceId || !isEqual(lastFilterKeys.current, filterKeys);
            lastFilterKeys.current = filterKeys;
            lastSpaceId.current = spaceId;

            if (shouldScrollIndexIntoView) {
                return {
                    align: `start`,
                    index: activeIndex || 0,
                    behavior: "auto",
                };
            }
            return false;
        },
        [activeIndex],
    );

    const keyDownCallback = useCallback((ev: React.KeyboardEvent) => {
        const navAction = getKeyBindingsManager().getNavigationAction(ev);
        if (navAction === KeyBindingAction.NextLandmark || navAction === KeyBindingAction.PreviousLandmark) {
            LandmarkNavigation.findAndFocusNextLandmark(
                Landmark.ROOM_LIST,
                navAction === KeyBindingAction.PreviousLandmark,
            );
            ev.stopPropagation();
            ev.preventDefault();
            return;
        }
    }, []);
    const context = useMemo<Context>(
        () => ({ spaceId: roomsResult.spaceId, filterKeys: roomsResult.filterKeys }),
        [roomsResult.spaceId, roomsResult.filterKeys],
    );

    return (
        <ListView
            context={context}
            scrollIntoViewOnChange={scrollIntoViewOnChange}
            initialTopMostItemIndex={activeIndex}
            data-testid="room-list"
            role="listbox"
            aria-label={_t("room_list|list_title")}
            fixedItemHeight={itemHeight}
            items={roomsResult.rooms}
            getItemComponent={getItemComponent}
            getItemKey={getItemKey}
            isItemFocusable={() => true}
            onKeyDown={keyDownCallback}
            increaseViewportBy={{
                bottom: extendedViewportHeight,
                top: extendedViewportHeight,
            }}
        />
    );
}
