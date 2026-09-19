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

/**
 * When `user` was last active: the homeserver's last-active time (last_active_ago relative to when the
 * presence arrived). Bridges keep it accurate; status messages are ignored.
 */
export function lastActiveTs(user: User): number | undefined {
    if (user.lastPresenceTs && user.lastActiveAgo !== undefined && user.lastActiveAgo >= 0) {
        return user.lastPresenceTs - user.lastActiveAgo;
    }
    return undefined;
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
