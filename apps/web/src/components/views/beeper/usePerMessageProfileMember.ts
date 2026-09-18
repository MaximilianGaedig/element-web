/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { useMemo } from "react";
import { type MatrixEvent, type RoomMember } from "matrix-js-sdk/src/matrix";

import { getPerMessageProfile } from "../../../utils/beeper/perMessageProfile";

/** The subset of a RoomMember the sender-profile view model reads. */
export interface PerMessageProfileMember {
    userId: string;
    roomId: string;
    rawDisplayName: string;
    disambiguate: boolean;
}

/**
 * If the event carries a Beeper per-message profile with a displayname, returns member info that
 * shows that name instead of the Matrix sender's. Otherwise returns the room member unchanged.
 */
export function usePerMessageProfileMember(
    mxEvent: MatrixEvent,
    member: RoomMember | null | undefined,
): RoomMember | PerMessageProfileMember | null | undefined {
    const profile = getPerMessageProfile(mxEvent);
    const displayname = profile?.displayname;
    const sender = mxEvent.getSender() ?? "";
    const roomId = mxEvent.getRoomId() ?? "";
    return useMemo(() => {
        if (!displayname) return member;
        return { userId: sender, roomId, rawDisplayName: displayname, disambiguate: false };
    }, [displayname, member, sender, roomId]);
}
