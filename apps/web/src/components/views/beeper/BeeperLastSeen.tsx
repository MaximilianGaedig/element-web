/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { type MatrixClient, type Room, RoomEvent, type User, UserEvent } from "matrix-js-sdk/src/matrix";
import { Text } from "@vector-im/compound-web";

import { useDmMember } from "../avatars/WithPresenceIndicator";
import { useEventEmitter } from "../../../hooks/useEventEmitter";
import MatrixClientContext from "../../../contexts/MatrixClientContext";
import { _t } from "../../../languageHandler";
import { useSettingValue } from "../../../hooks/useSettings";
import { isPresenceEnabled } from "../../../utils/presence";
import { formatLastSeen, formatLastSeenTime, isVagueLastSeen } from "../../../utils/beeper/lastSeen";

const TICK_MS = 30_000;

/**
 * Telegram-style "online" / "last seen …" text for a user, kept live; undefined if none applies.
 * Listens on the client (users created via User.createUser re-emit there) so it also picks up a
 * User object that only appears later, e.g. from the sliding-sync presence poller.
 */
export function useLastSeen(client: MatrixClient | undefined, userId: string | undefined): string | undefined {
    const showTwelveHour = useSettingValue("showTwelveHourTimestamps");
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
        return () => window.clearInterval(id);
    }, []);

    const read = useCallback(() => {
        const user = userId ? client?.getUser(userId) : null;
        return { presence: user?.presence, msg: user?.presenceStatusMsg, exists: !!user };
    }, [client, userId]);
    const [state, setState] = useState(read);
    useEffect(() => setState(read()), [read]);
    // LastPresenceTs fires for every presence event; Presence only when the state itself changes,
    // which would miss a new status_msg ("last seen …") while the user stays offline.
    useEventEmitter(client, UserEvent.LastPresenceTs, (_ev: unknown, user?: User) => {
        if (user?.userId === userId) setState(read());
    });
    if (!state.exists) return undefined;
    return formatLastSeen(state.presence, state.msg, { now, showTwelveHour });
}

/**
 * The most recent activity of `userId` we can see in `room`: their latest event in the live timeline
 * or their latest read receipt, whichever is newer. Used when the network hides the real last-seen.
 */
export function lastActivityTs(room: Room, userId: string): number | undefined {
    let ts: number | undefined;
    const events = room.getLiveTimeline().getEvents();
    for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].getSender() === userId && !events[i].isState()) {
            ts = events[i].getTs();
            break;
        }
    }
    const receiptTs = room.getReadReceiptForUserId(userId, true)?.data?.ts;
    if (receiptTs && (!ts || receiptTs > ts)) ts = receiptTs;
    return ts;
}

function useLastActivity(room: Room, userId: string | undefined): number | undefined {
    const read = useCallback(() => (userId ? lastActivityTs(room, userId) : undefined), [room, userId]);
    const [ts, setTs] = useState(read);
    useEffect(() => setTs(read()), [read]);
    const update = useCallback(() => setTs(read()), [read]);
    useEventEmitter(room, RoomEvent.Timeline, update);
    useEventEmitter(room, RoomEvent.Receipt, update);
    return ts;
}

/** Subtitle under a DM's name in the room header, like Telegram's "last seen …" line. */
export function BeeperDmLastSeenSubtitle({ room }: { room: Room }): JSX.Element | null {
    const member = useDmMember(room);
    let text = useLastSeen(room.client, member?.userId);
    const activity = useLastActivity(room, member?.userId);
    const showTwelveHour = useSettingValue("showTwelveHourTimestamps");
    // The network hid the exact time ("last seen recently"): show the newest activity we saw instead.
    const statusMsg = member?.userId ? room.client.getUser(member.userId)?.presenceStatusMsg : undefined;
    if (activity && isVagueLastSeen(statusMsg) && text !== _t("beeper|last_seen_online")) {
        text = formatLastSeenTime(activity, { showTwelveHour }, "active");
    }
    if (!text || !isPresenceEnabled(room.client)) return null;
    return (
        <Text as="div" size="sm" className="mx_BeeperLastSeen" data-online={text === _t("beeper|last_seen_online")}>
            {text}
        </Text>
    );
}

/** Shows the last-seen text in user info when there is one, otherwise `fallback` (Element's label). */
export function BeeperLastSeenLabel({ userId, fallback }: { userId: string; fallback: ReactNode }): JSX.Element {
    const client = useContext(MatrixClientContext);
    const text = useLastSeen(client, userId);
    // Element's own label already covers "online"; only replace it when the bridge says more.
    if (!text || text === _t("beeper|last_seen_online")) return <>{fallback}</>;
    return <div className="mx_PresenceLabel mx_UserInfo_profileStatus mx_BeeperLastSeen">{text}</div>;
}
