/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 */

import { type Room } from "matrix-js-sdk/src/matrix";

import SpaceStore from "../stores/spaces/SpaceStore";
import { filterBoolean } from "./arrays";

/**
 * Entry representing a space in a path.
 */
export interface SpacePathEntry {
    /** The room ID of the space. */
    id: string;
    /** The name of the space. */
    name: string;
    /** The Room object of the space. */
    room: Room;
}

/**
 * Gets the path of spaces for a given room.
 *
 * This function will attempt to find a path from the room up to a root space.
 * It respects relative pruning if an activeSpace is provided and is part of the path.
 *
 * @param room - The room to get the path for.
 * @param activeSpace - The currently active space in the sidebar. Used for relative pruning.
 * @param canonicalOnly - Whether to only follow canonical parent relationships.
 * @returns The path of spaces leading to the room, excluding the room itself.
 */
export function getSpacePath(room: Room, activeSpace?: string, canonicalOnly = false): SpacePathEntry[] {
    const path: SpacePathEntry[] = [];
    const client = room.client;
    let currentRoomId = room.roomId;

    const visited = new Set<string>([currentRoomId]);

    // eslint-disable-next-line no-constant-condition
    while (true) {
        // Try to get verified parents first (m.space.parent events)
        let parents = SpaceStore.instance.getParents(currentRoomId, canonicalOnly);

        // Fallback to parentMap (m.space.child events from parents) if no m.space.parent exists
        if (parents.length === 0 && !canonicalOnly) {
            const knownParentIds = SpaceStore.instance.getKnownParents(currentRoomId);
            parents = filterBoolean(Array.from(knownParentIds).map((id) => client.getRoom(id)));
        }

        if (parents.length === 0) break;

        // Priority:
        // 1. If activeSpace is in parents, choose it and STOP (relative pruning)
        // 2. Canonical parent (if available)
        // 3. First parent
        const activeParent = parents.find((p) => p.roomId === activeSpace);
        if (activeParent) {
            // Found the active space, we stop here for relative pruning
            break;
        }

        const parent = SpaceStore.instance.getCanonicalParent(currentRoomId) || parents[0];

        if (visited.has(parent.roomId)) break; // Cycle detection
        visited.add(parent.roomId);

        path.unshift({
            id: parent.roomId,
            name: parent.name,
            room: parent,
        });

        currentRoomId = parent.roomId;
    }

    return path;
}
