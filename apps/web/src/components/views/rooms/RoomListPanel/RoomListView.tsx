/*
 * Copyright 2025 New Vector Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { useCallback, type JSX, type ReactNode, useContext } from "react";
import {
    RoomListView as SharedRoomListView,
    useCreateAutoDisposedViewModel,
    type Room as SharedRoom,
    type RoomListItemSendState,
} from "@element-hq/web-shared-components";
import { Room } from "matrix-js-sdk/src/matrix";

import { DecoratedRoomAvatarView } from "../../avatars/DecoratedRoomAvatarView";
import { BridgedRoomAvatar } from "../../bridge/BridgeNetworkIcon";
import RoomAvatar from "../../avatars/RoomAvatar";
import { PreviewRoomAvatarData } from "../../../../viewmodels/room-list/PreviewRoomAvatarData";
import { getKeyBindingsManager } from "../../../../KeyBindingsManager";
import { KeyBindingAction } from "../../../../accessibility/KeyboardShortcuts";
import { Landmark, LandmarkNavigation } from "../../../../accessibility/LandmarkNavigation";
import { RoomListViewModel } from "../../../../viewmodels/room-list/RoomListViewModel";
import { SDKContext } from "../../../../contexts/SDKContext.ts";
import { RoomPath } from "../RoomPath";
import { WarmupOnRest } from "./WarmupOnRest";
import { TelegramSendStatusIcon } from "../../telegram/TelegramTime";

/**
 * RoomListView component using shared components with proper MVVM pattern.
 */
export function RoomListView(): JSX.Element {
    const sdkContext = useContext(SDKContext);

    // Create and auto-dispose ViewModel instance
    const vm = useCreateAutoDisposedViewModel(
        () =>
            new RoomListViewModel({
                client: sdkContext.client!,
                roomViewStore: sdkContext.roomViewStore,
                spaceStore: sdkContext.spaceStore,
            }),
    );

    // Render avatar for each room - memoized to prevent re-renders
    const client = sdkContext.client!;
    const renderAvatar = useCallback(
        (room: SharedRoom): ReactNode => {
            if (room instanceof Room) {
                return (
                    <>
                        <BridgedRoomAvatar room={room}>
                            <DecoratedRoomAvatarView room={room} />
                        </BridgedRoomAvatar>
                        <WarmupOnRest client={client} room={room} />
                    </>
                );
            }
            // A preview item has no `Room`, only the data needed for its avatar
            if (room instanceof PreviewRoomAvatarData) return <RoomAvatar size="32px" oobData={room} />;
            return null;
        },
        [client],
    );

    // Render room path breadcrumbs for each room (show full path, no pruning)
    const renderRoomPath = useCallback((room: SharedRoom): ReactNode => {
        // A preview item is not in any space yet, so it has no path
        if (!(room instanceof Room)) return null;
        return <RoomPath room={room} fullPath />;
    }, []);

    // Fork: our last message's ticks, the same glyphs as on the message in the timeline
    const renderSendState = useCallback(
        (state: RoomListItemSendState): ReactNode => <TelegramSendStatusIcon state={state} />,
        [],
    );

    // Handle keyboard navigation for landmarks
    const onKeyDown = useCallback((ev: React.KeyboardEvent) => {
        const navAction = getKeyBindingsManager().getNavigationAction(ev);
        if (navAction === KeyBindingAction.NextLandmark || navAction === KeyBindingAction.PreviousLandmark) {
            LandmarkNavigation.findAndFocusNextLandmark(
                Landmark.ROOM_LIST,
                navAction === KeyBindingAction.PreviousLandmark,
            );
            ev.stopPropagation();
            ev.preventDefault();
        }
    }, []);

    return (
        <SharedRoomListView
            vm={vm}
            renderAvatar={renderAvatar}
            renderRoomPath={renderRoomPath}
            renderSendState={renderSendState}
            onKeyDown={onKeyDown}
        />
    );
}
