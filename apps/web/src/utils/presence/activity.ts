/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type User } from "matrix-js-sdk/src/matrix";

/** How long after someone was last active their dot takes to fade out completely. */
export const ACTIVITY_FADE_MS = 60 * 60 * 1000;
/** Below this the dot is too faint to be useful and isn't rendered. */
export const MIN_ACTIVITY = 0.08;

const LAST_SEEN_PREFIX = "last seen ";

/**
 * When `user` was last active: the exact time bridges put in status_msg ("last seen <RFC 3339>"),
 * otherwise what the homeserver reports (last_active_ago relative to when the presence arrived).
 */
export function lastActiveTs(user: User): number | undefined {
    let ts: number | undefined;
    const msg = user.presenceStatusMsg;
    if (typeof msg === "string" && msg.startsWith(LAST_SEEN_PREFIX)) {
        const parsed = Date.parse(msg.slice(LAST_SEEN_PREFIX.length).trim());
        if (!isNaN(parsed)) ts = parsed;
    }
    if (user.lastPresenceTs && user.lastActiveAgo !== undefined && user.lastActiveAgo >= 0) {
        const fromServer = user.lastPresenceTs - user.lastActiveAgo;
        if (!ts || fromServer > ts) ts = fromServer;
    }
    return ts;
}

/**
 * How "present" `user` is, from 0 to 1: 1 while online (or currently active), then fading linearly to
 * 0 over {@link ACTIVITY_FADE_MS} after they were last active. Anything below {@link MIN_ACTIVITY} is 0,
 * so offline and long-idle users get no dot at all.
 */
export function activityLevel(user: User | null | undefined, now = Date.now()): number {
    if (!user) return 0;
    if (user.currentlyActive || user.presence === "online") return 1;
    const ts = lastActiveTs(user);
    if (ts === undefined) return 0;
    const level = 1 - Math.max(0, now - ts) / ACTIVITY_FADE_MS;
    return level >= MIN_ACTIVITY ? Math.min(1, level) : 0;
}
