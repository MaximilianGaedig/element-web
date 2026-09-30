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
import PresenceIconView from "../rooms/MemberList/tiles/common/PresenceIconView";
import { NetworkLogo } from "./NetworkLogo";
import { type Presence } from "../../../utils/contacts/presence";

export function ContactFace({
    client,
    name,
    id,
    avatarUrl,
    /** The chat whose network badges the face; the first of theirs, as the row's subject. */
    roomId,
    presence,
    size = 36,
    /** A tick over the face while a selection is being made, in place of the network badge. */
    selected,
}: {
    client: MatrixClient;
    name: string;
    id?: string;
    avatarUrl?: string;
    roomId?: string;
    presence?: Presence;
    size?: number;
    selected?: boolean;
}): JSX.Element {
    const url = avatarUrl ? mediaFromMxc(avatarUrl).getSquareThumbnailHttp(size * 2) : null;
    return (
        <span className="mx_Contacts_face" style={{ width: size, height: size }}>
            <BaseAvatar name={name} idName={id ?? name} url={url ?? undefined} size={`${size}px`} />
            {/* Bottom-left, as the room list puts it, so the two lists mark a network the same way. */}
            {!selected && <NetworkLogo client={client} roomId={roomId} size={Math.round(size / 2.6)} />}
            {!selected && presence && <PresenceIconView className="mx_Contacts_presence" presenceState={presence} />}
        </span>
    );
}
