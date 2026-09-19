/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type MatrixClient, type User, UserEvent } from "matrix-js-sdk/src/matrix";
import { useCallback, useEffect, useState } from "react";

import { useEventEmitter } from "../../hooks/useEventEmitter";
import { presenceNow, usePresenceNow } from "./clock";

/** How long after someone was last active they still get a "12m" / "5h" tag (then nothing). */
export const TAG_WINDOW_MINUTES = 24 * 60;

/**
 * Everything any presence display shows, derived once: the avatar tag ("5m") and the "last seen 5
 * minutes ago" text both render from this, so they can't disagree.
 */
export interface PresenceInfo {
    online: boolean;
    /** When they were last active (the homeserver's last_active_ago); bridges keep it accurate. */
    lastActive?: number;
    /** Whole minutes since `lastActive` at the shared presence clock's "now". */
    minutes?: number;
}

/** When `user` was last active: last_active_ago relative to when the presence arrived. */
export function lastActiveTs(user: User): number | undefined {
    if (user.lastPresenceTs && user.lastActiveAgo !== undefined && user.lastActiveAgo >= 0) {
        return user.lastPresenceTs - user.lastActiveAgo;
    }
    return undefined;
}

export function presenceInfo(user: User | null | undefined, now = presenceNow()): PresenceInfo | undefined {
    if (!user) return undefined;
    const online = !!user.currentlyActive || user.presence === "online";
    const lastActive = lastActiveTs(user);
    if (lastActive === undefined) return { online };
    return { online, lastActive, minutes: Math.floor(Math.max(0, now - lastActive) / 60_000) };
}

/** The avatar tag, Messenger style: "1m" to "59m", then "1h" to "23h"; none when online or after a day. */
export function presenceTag(info: PresenceInfo | undefined): string | undefined {
    if (!info || info.online || info.minutes === undefined || info.minutes >= TAG_WINDOW_MINUTES) return undefined;
    const minutes = Math.max(1, info.minutes);
    return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`;
}

/** Whether there is anything to badge: online, or a tag. */
export function hasPresenceBadge(info: PresenceInfo | undefined): boolean {
    return !!info && (info.online || presenceTag(info) !== undefined);
}

function samePresence(a: PresenceInfo | undefined, b: PresenceInfo | undefined): boolean {
    return a?.online === b?.online && a?.lastActive === b?.lastActive && a?.minutes === b?.minutes;
}

/**
 * The one presence hook: `userId`'s {@link PresenceInfo}, live on presence events and the shared clock.
 * Listens on the client (users created via User.createUser re-emit there) so it also picks up a User
 * that only appears later, e.g. from the sliding-sync presence poller.
 */
export function usePresenceInfo(
    client: MatrixClient | undefined,
    userId: string | undefined,
): PresenceInfo | undefined {
    const now = usePresenceNow();
    const read = useCallback(
        (at: number) => presenceInfo(userId ? client?.getUser(userId) : null, at),
        [client, userId],
    );
    const [info, setInfo] = useState(() => read(now));
    const update = (): void => {
        const next = read(presenceNow());
        setInfo((prev) => (samePresence(prev, next) ? prev : next));
    };
    useEffect(update, [read, now]);
    const onUser = (_ev: unknown, user?: User): void => {
        if (user?.userId === userId) update();
    };
    // LastPresenceTs fires for every presence event; Presence only when the state itself changes,
    // which would miss a new last-active time while the user stays offline.
    useEventEmitter(client, UserEvent.LastPresenceTs, onUser);
    useEventEmitter(client, UserEvent.Presence, onUser);
    useEventEmitter(client, UserEvent.CurrentlyActive, onUser);
    return info;
}
