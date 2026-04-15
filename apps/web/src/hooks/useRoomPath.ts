/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 */

import { useState, useEffect, useCallback } from "react";
import { type Room, RoomEvent } from "matrix-js-sdk/src/matrix";

import SpaceStore from "../stores/spaces/SpaceStore";
import { UPDATE_SELECTED_SPACE } from "../stores/spaces";
import { getSpacePath, type SpacePathEntry } from "../utils/SpaceHierarchyUtils";
import { useEventEmitter } from "./useEventEmitter";

/**
 * Hook to get the path of spaces for a given room.
 *
 * Listens to SpaceStore updates and room name changes to keep the path updated.
 *
 * @param room - The room to get the path for.
 * @returns The current space path for the room.
 */
export function useRoomPath(room: Room): SpacePathEntry[] {
    const [path, setPath] = useState<SpacePathEntry[]>(() => getSpacePath(room, SpaceStore.instance.activeSpace));

    const updatePath = useCallback(() => {
        setPath(getSpacePath(room, SpaceStore.instance.activeSpace));
    }, [room]);

    useEventEmitter(SpaceStore.instance, UPDATE_SELECTED_SPACE, updatePath);
    // Also update if the room itself is moved or parents change.
    // SpaceStore emits events on room IDs when their hierarchy changes.
    useEventEmitter(SpaceStore.instance, room.roomId, updatePath);

    useEffect(() => {
        room.on(RoomEvent.Name, updatePath);
        return () => {
            room.off(RoomEvent.Name, updatePath);
        };
    }, [room, updatePath]);

    return path;
}
