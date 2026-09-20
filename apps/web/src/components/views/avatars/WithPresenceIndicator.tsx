/*
Copyright 2024 New Vector Ltd.
Copyright 2024 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, type ReactNode, useEffect, useState } from "react";
import { ClientEvent, type Room, RoomMember, RoomStateEvent, type User } from "matrix-js-sdk/src/matrix";

import { isPresenceEnabled } from "../../../utils/presence";
import DMRoomMap from "../../../utils/DMRoomMap";
import { getJoinedNonFunctionalMembers } from "../../../utils/room/getJoinedNonFunctionalMembers";
import { useEventEmitter } from "../../../hooks/useEventEmitter";
import { BUSY_PRESENCE_NAME } from "../rooms/PresenceLabel";
import { getBridgedDmUserId } from "../../../utils/bridge/bridgeInfo";
import AvatarPresenceIconView from "../rooms/MemberList/tiles/common/PresenceIconView";
import { hasPresenceBadge, type PresenceInfo, usePresenceInfo } from "../../../utils/presence/activity";
import { ActivityDot } from "./ActivityDot";
import { _t } from "../../../languageHandler";

interface Props {
    room: Room;
    children: ReactNode;
}

export enum Presence {
    // This class used to have its own presence indicator and has been
    // updated to use the new one so presence colours / icons match across the app.
    // These values are the ones from the wire that PresenceIconView expects,
    // but really some of the logic here could be deduplicated.
    Online = "online",
    Away = "unavailable",
    Offline = "offline",
    Busy = "busy",
}

function getDmMember(room: Room): RoomMember | null {
    // Bridged DM portals may be missing from m.direct; fall back to the bridge's room type.
    const otherUserId = DMRoomMap.shared().getUserIdForRoomId(room.roomId) ?? getBridgedDmUserId(room);
    if (!otherUserId) return null;
    // With sliding sync the member list may not be loaded yet; presence only needs the user ID.
    return room.getMember(otherUserId) ?? new RoomMember(room.roomId, otherUserId);
}

export const useDmMember = (room?: Room): RoomMember | null => {
    const [dmMember, setDmMember] = useState<RoomMember | null>(room ? getDmMember(room) : null);
    const updateDmMember = (): void => {
        setDmMember(room ? getDmMember(room) : null);
    };

    useEventEmitter(room?.currentState, RoomStateEvent.Members, updateDmMember);
    useEventEmitter(room?.client, ClientEvent.AccountData, updateDmMember);
    useEffect(updateDmMember, [room]);

    return dmMember;
};

function getPresenceFromUser(user: User | null | undefined): Presence | null {
    if (!user) return null;

    const presence = user.presence;
    const isOnline = user.currentlyActive || presence === "online";
    if (BUSY_PRESENCE_NAME.matches(presence)) {
        return Presence.Busy;
    }
    if (isOnline) {
        return Presence.Online;
    }
    if (presence === "offline") {
        return Presence.Offline;
    }
    if (presence === "unavailable") {
        return Presence.Away;
    }

    return null;
}

/**
 * Presence for decorations: busy stays busy; otherwise online while the user is online or has a
 * recently-active tag (see presenceTag), and nothing at all for away/offline, so there is no grey dot.
 * `info` is the one {@link usePresenceInfo} result, so the decoration and the tag always agree.
 */
export const usePresence = (room: Room, member: RoomMember | null, info: PresenceInfo | undefined): Presence | null => {
    const user = member ? room.client.getUser(member.userId) : null;
    const joined = getJoinedNonFunctionalMembers(room).length;
    // Fewer than 2 joined members means the (sliding sync) member list isn't loaded yet; trust m.direct.
    const isOneToOne = joined === 2 || !!getBridgedDmUserId(room) || (joined < 2 && !!member);
    if (!isOneToOne || !isPresenceEnabled(room.client)) return null;
    if (getPresenceFromUser(user) === Presence.Busy) return Presence.Busy;
    return hasPresenceBadge(info) ? Presence.Online : null;
};

/** The DM member's presence, for the avatar decoration. */
export const useDmPresence = (room: Room): { presence: Presence | null; info: PresenceInfo | undefined } => {
    const member = useDmMember(room);
    const info = usePresenceInfo(room.client, member?.userId);
    return { presence: usePresence(room, member, info), info };
};

const WithPresenceIndicator: React.FC<Props> = ({ room, children }) => {
    const { presence, info } = useDmPresence(room);

    let icon: JSX.Element | null | undefined;
    if (presence === Presence.Online) {
        icon = <ActivityDot info={info} label={_t("presence|online")} />;
    } else if (presence) {
        icon = <AvatarPresenceIconView presenceState={presence} />;
    }

    if (!presence) return <>{children}</>;

    return (
        <div className="mx_WithPresenceIndicator">
            {children}
            <div className="mx_WithPresenceIndicator_icon">{icon}</div>
        </div>
    );
};

/** @knipignore Only the tests render the wrapper itself; the app imports the Presence enum above. */
export default WithPresenceIndicator;
