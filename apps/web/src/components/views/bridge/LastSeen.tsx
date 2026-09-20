/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, type ReactNode, useContext } from "react";
import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";
import { Text } from "@vector-im/compound-web";

import { useDmMember } from "../avatars/WithPresenceIndicator";
import MatrixClientContext from "../../../contexts/MatrixClientContext";
import { _t } from "../../../languageHandler";
import { useSettingValue } from "../../../hooks/useSettings";
import { isPresenceEnabled } from "../../../utils/presence";
import { formatPresence } from "../../../utils/presence/lastSeen";
import { usePresenceInfo } from "../../../utils/presence/activity";
import { TypingIndicatorLine, useHeaderTypingText } from "./TypingSubtitle";

/** Telegram-style "online" / "last seen …" text for a user, from the one {@link usePresenceInfo}. */
export function useLastSeen(client: MatrixClient | undefined, userId: string | undefined): string | undefined {
    const showTwelveHour = useSettingValue("showTwelveHourTimestamps");
    return formatPresence(usePresenceInfo(client, userId), { showTwelveHour });
}

/**
 * Subtitle under a DM's name in the room header, like Telegram's "last seen …" line; replaced by
 * an animated "typing" while the other side types.
 */
export function DmLastSeenSubtitle({
    room,
    alsoShow,
}: {
    room: Room;
    /** Another status for the same line (the history import): shown beside the last-seen text, never instead of it. */
    alsoShow?: JSX.Element | null;
}): JSX.Element | null {
    const member = useDmMember(room);
    const typing = useHeaderTypingText(room, true);
    const text = useLastSeen(room.client, member?.userId);
    // Typing always wins the line, as in Telegram.
    if (typing) return <TypingIndicatorLine text={typing} />;
    const seen =
        text && isPresenceEnabled(room.client) ? (
            <Text as="div" size="sm" className="mx_LastSeen" data-online={text === _t("bridge|last_seen_online")}>
                {text}
            </Text>
        ) : null;
    // Presence is the one source (bridges keep it current from what they see on the network). The import
    // status never replaces or swaps with it: it sits beside it on the same line.
    if (!seen && !alsoShow) return null;
    if (!alsoShow) return seen;
    return (
        <div className="mx_HeaderStatusRow">
            {seen}
            {alsoShow}
        </div>
    );
}

/** Shows the last-seen text in user info when there is one, otherwise `fallback` (Element's label). */
export function LastSeenLabel({ userId, fallback }: { userId: string; fallback: ReactNode }): JSX.Element {
    const client = useContext(MatrixClientContext);
    const text = useLastSeen(client, userId);
    // Element's own label already covers "online"; only replace it when the bridge says more.
    if (!text || text === _t("bridge|last_seen_online")) return <>{fallback}</>;
    return <div className="mx_PresenceLabel mx_UserInfo_profileStatus mx_LastSeen">{text}</div>;
}
