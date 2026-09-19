/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 */

import { type Room } from "matrix-js-sdk/src/matrix";

import type { SpacePathEntry } from "../SpaceHierarchyUtils";

/**
 * Whether `space` is a bridge's personal filtering space (e.g. "Telegram (…)", "Discord"): a
 * container the bridge bot creates just to hold your bridged chats. Detected by shape: created by a
 * bot account, and nobody but that bot and you in it. Such a root adds nothing to a breadcrumb.
 */
export function isBridgePersonalSpace(space: Room): boolean {
    if (!space.isSpaceRoom()) return false;
    const me = space.client.getUserId();
    const creator = space.getCreator();
    if (!creator || creator === me) return false;
    const localpart = creator.slice(1).split(":")[0];
    if (!/bot$/i.test(localpart)) return false;
    return space.getJoinedMembers().every((m) => m.userId === creator || m.userId === me);
}

/** Drops a bridge's personal space from the root of a path, keeping real hierarchy below it. */
export function withoutBridgeRoot(path: SpacePathEntry[]): SpacePathEntry[] {
    return path.length && isBridgePersonalSpace(path[0].room) ? path.slice(1) : path;
}
