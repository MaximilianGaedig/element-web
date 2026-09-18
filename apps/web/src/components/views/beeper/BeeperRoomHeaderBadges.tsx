/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";
import { Tooltip } from "@vector-im/compound-web";
import { TimeIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import { useRoomState } from "../../../hooks/useRoomState";
import { _t } from "../../../languageHandler";
import {
    type DisappearingTimer,
    formatDisappearingDuration,
    getRoomDisappearingTimer,
} from "../../../utils/beeper/disappearingMessages";

function disappearingLabel(timer: DisappearingTimer): string {
    const duration = formatDisappearingDuration(timer.timer);
    return timer.type === "after_send"
        ? _t("beeper|disappearing_room_after_send", { duration })
        : _t("beeper|disappearing_room_after_read", { duration });
}

/** Shows the room's disappearing-messages timer (com.beeper.disappearing_timer state). */
export function DisappearingTimerHeaderBadge({ room }: { room: Room }): JSX.Element | null {
    const timer = useRoomState(room, () => getRoomDisappearingTimer(room));
    if (!timer) return null;
    const label = disappearingLabel(timer);
    return (
        <Tooltip label={label} placement="right">
            <span className="mx_BeeperRoomHeaderBadge mx_BeeperRoomHeaderBadge_disappearing" aria-label={label}>
                <TimeIcon width="16px" height="16px" aria-hidden />
                {formatDisappearingDuration(timer.timer)}
            </span>
        </Tooltip>
    );
}

/** Room header indicators driven by Beeper/mautrix bridge state events. */
export default function BeeperRoomHeaderBadges({ room }: { room: Room }): JSX.Element {
    return (
        <>
            <DisappearingTimerHeaderBadge room={room} />
        </>
    );
}
