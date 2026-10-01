/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * A face, marked the way the room list marks one.
 *
 * The room list already answers "which network is this" and "are they about" on an avatar, and it answers
 * them in particular places: the network's logo in the bottom-left corner, the presence dot in the
 * bottom-right (see _BridgeInfo.pcss, which says exactly that). Contacts asking the same two questions in
 * different places would be the same client disagreeing with itself, so this puts them where they go.
 */

import React, { type JSX } from "react";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import BaseAvatar from "../avatars/BaseAvatar";
import { mediaFromMxc } from "../../../customisations/Media";
import { ActivityDot } from "../avatars/ActivityDot";
import { NetworkLogo } from "./NetworkLogo";
import { hasPresenceBadge, type PresenceInfo } from "../../../utils/presence/activity";
import { _t } from "../../../languageHandler";

export function ContactFace({
    client,
    name,
    id,
    avatarUrl,
    thumbnailUrl,
    /** The chat whose network badges the face; the first of theirs, as the row's subject. */
    roomId,
    network,
    presence,
    size = 36,
    logoSize,
    /** A tick over the face while a selection is being made, in place of the network badge. */
    selected,
}: {
    client: MatrixClient;
    name: string;
    id?: string;
    avatarUrl?: string;
    /** A thumbnail already made from the avatar, where only that is at hand (the member list's model). */
    thumbnailUrl?: string;
    roomId?: string;
    /** Their network, badging the face when there is no chat to read it from. */
    network?: string;
    /** The room list's own presence reading, drawn with the room list's own badge. */
    presence?: PresenceInfo;
    size?: number;
    /** The network logo's size, where the face stands beside the room list's and has to match its 14px. */
    logoSize?: number;
    selected?: boolean;
}): JSX.Element {
    const badge = !selected && hasPresenceBadge(presence);
    // The "12m" tag is wider than the dot and has its own cut-out, as in the room list.
    const mask = presence?.online ? " mx_RoomAvatarView_RoomAvatar_presence" : " mx_RoomAvatarView_RoomAvatar_recent";
    const url = thumbnailUrl ?? (avatarUrl ? mediaFromMxc(avatarUrl).getSquareThumbnailHttp(size * 2) : null);
    /*
     * The room list's own composition, not an imitation of it.
     *
     * It does not draw a ringed dot on top of the picture - it masks a hole out of the avatar
     * (mx_RoomAvatarView_RoomAvatar_presence, _RoomAvatarView.pcss) and sits the indicator in the gap, which
     * is why its badges look cut into the face rather than stuck onto it. Using the same classes means the
     * same mask, the same 8px icon and the same placement, all driven by --room-avatar-size.
     */
    return (
        <span
            className="mx_Contacts_face mx_RoomAvatarView"
            style={{ "--room-avatar-size": `${size}px` } as React.CSSProperties}
        >
            <BaseAvatar
                className={`mx_RoomAvatarView_RoomAvatar${badge ? mask : ""}`}
                name={name}
                idName={id ?? name}
                url={url ?? undefined}
                size={`${size}px`}
            />
            {/* Bottom-left, as the room list puts a network, so the two lists mark one the same way. */}
            {!selected && (
                <NetworkLogo
                    client={client}
                    roomId={roomId}
                    network={network}
                    size={logoSize ?? Math.round(size / 2.6)}
                />
            )}
            {badge && (
                <ActivityDot
                    info={presence}
                    className="mx_RoomAvatarView_PresenceDecoration"
                    label={_t("presence|online")}
                />
            )}
        </span>
    );
}
