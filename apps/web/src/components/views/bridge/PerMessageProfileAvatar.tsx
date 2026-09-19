/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, type ReactNode, useContext } from "react";
import { type MatrixEvent } from "matrix-js-sdk/src/matrix";

import BaseAvatar from "../avatars/BaseAvatar";
import MatrixClientContext from "../../../contexts/MatrixClientContext";
import { mediaFromMxc } from "../../../customisations/Media";
import { getPerMessageProfile } from "../../../utils/bridge/perMessageProfile";
import { _t } from "../../../languageHandler";

interface Props {
    mxEvent: MatrixEvent;
    size: string;
    /** Rendered when the event has no per-message profile (normally a MemberAvatar). */
    children: ReactNode;
}

/**
 * Shows the avatar from a per-message profile (bridge relay mode) instead of the sender's.
 * A profile with only a displayname gets an initial-letter avatar coloured by the profile id, so
 * different remote senders relayed through one Matrix user are visually distinct.
 */
export default function PerMessageProfileAvatar({ mxEvent, size, children }: Props): JSX.Element {
    const cli = useContext(MatrixClientContext);
    const profile = getPerMessageProfile(mxEvent);
    if (!profile) return <>{children}</>;

    const px = parseInt(size, 10);
    const url = profile.avatar_url
        ? mediaFromMxc(profile.avatar_url, cli).getThumbnailOfSourceHttp(px, px, "crop")
        : undefined;
    const name = profile.displayname ?? mxEvent.getSender() ?? "";
    return (
        <BaseAvatar
            size={size}
            name={name}
            idName={profile.id || name}
            url={url}
            title={_t("bridge|per_message_profile_via", { name, sender: mxEvent.getSender() ?? "" })}
            altText={_t("common|user_avatar")}
        />
    );
}
