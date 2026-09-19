/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type User } from "matrix-js-sdk/src/matrix";

/** How long after someone was last active they still get a "12m" / "5h" tag (then nothing). */
export const ACTIVITY_FADE_MS = 24 * 60 * 60 * 1000;
/** Below this there's no tag (0: the whole window counts). */
export const MIN_ACTIVITY = 0;

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
    // A bridge's exact "last seen" is the network's own answer. The homeserver's last_active_ago only
    // counts from when the bridge last set the presence, so it's newer than the truth: use it only for
    // users without one (ordinary Matrix users).
    if (ts !== undefined) return ts;
    if (user.lastPresenceTs && user.lastActiveAgo !== undefined && user.lastActiveAgo >= 0) {
        ts = user.lastPresenceTs - user.lastActiveAgo;
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
    return level > MIN_ACTIVITY ? Math.min(1, level) : 0;
}
