/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, type ReactNode, useCallback, useEffect, useState } from "react";
import { type Room, type User, UserEvent } from "matrix-js-sdk/src/matrix";
import { Text } from "@vector-im/compound-web";

import { useDmMember } from "../avatars/WithPresenceIndicator";
import { useEventEmitterState } from "../../../hooks/useEventEmitter";
import { useSettingValue } from "../../../hooks/useSettings";
import { isPresenceEnabled } from "../../../utils/presence";
import { formatLastSeen } from "../../../utils/beeper/lastSeen";

const TICK_MS = 30_000;

/** Telegram-style "online" / "last seen …" text for a user, kept live; undefined if none applies. */
export function useLastSeen(user: User | null | undefined): string | undefined {
    const showTwelveHour = useSettingValue("showTwelveHourTimestamps");
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
        return () => window.clearInterval(id);
    }, []);

    const read = useCallback(() => ({ presence: user?.presence, msg: user?.presenceStatusMsg }), [user]);
    // LastPresenceTs fires for every presence event; Presence only when the state itself changes,
    // which would miss a new status_msg ("last seen …") while the user stays offline.
    const { presence, msg } = useEventEmitterState(user ?? undefined, UserEvent.LastPresenceTs, read);
    if (!user) return undefined;
    return formatLastSeen(presence, msg, { now, showTwelveHour });
}

/** Subtitle under a DM's name in the room header, like Telegram's "last seen …" line. */
export function BeeperDmLastSeenSubtitle({ room }: { room: Room }): JSX.Element | null {
    const member = useDmMember(room);
    const user = member ? (member.user ?? room.client.getUser(member.userId)) : null;
    const text = useLastSeen(user);
    if (!text || !isPresenceEnabled(room.client)) return null;
    return (
        <Text as="div" size="sm" className="mx_BeeperLastSeen" data-online={user?.presence === "online"}>
            {text}
        </Text>
    );
}

/** Shows the last-seen text in user info when there is one, otherwise `fallback` (Element's label). */
export function BeeperLastSeenLabel({
    user,
    fallback,
}: {
    user: User | null | undefined;
    fallback: ReactNode;
}): JSX.Element {
    const text = useLastSeen(user);
    // Element's own label already covers "online"; only replace it when the bridge says more.
    if (!text || user?.presence === "online") return <>{fallback}</>;
    return <div className="mx_PresenceLabel mx_UserInfo_profileStatus mx_BeeperLastSeen">{text}</div>;
}
