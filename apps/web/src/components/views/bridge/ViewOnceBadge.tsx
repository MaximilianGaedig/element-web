/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useContext } from "react";
import { type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { Tooltip } from "@vector-im/compound-web";
import { VisibilityOnIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import MatrixClientContext from "../../../contexts/MatrixClientContext";
import { _t } from "../../../languageHandler";
import { getBridgeNetworkName } from "../../../utils/bridge/roomFeatures";
import { isViewOnceEvent } from "../../../utils/bridge/viewOnce";

interface Props {
    mxEvent: MatrixEvent;
}

/**
 * Marks media sent as view-once (com.beeper.view_limited in the content). The Matrix copy does not
 * vanish when the other side opens it, so on our own message the tooltip says so rather than
 * letting the label suggest otherwise.
 */
export default function ViewOnceBadge({ mxEvent }: Props): JSX.Element | null {
    const client = useContext(MatrixClientContext);
    if (!isViewOnceEvent(mxEvent)) return null;

    const text = _t("bridge|view_once");
    // Shares the look (and the place in either layout) of the disappearing-message timer.
    const className = "mx_DisappearingMessageBadge mx_ViewOnceBadge";
    const icon = <VisibilityOnIcon width="12" height="12" aria-hidden />;

    const room = client?.getRoom(mxEvent.getRoomId());
    if (!room || mxEvent.getSender() !== client?.getUserId()) {
        return (
            <span className={className}>
                {icon}
                {text}
            </span>
        );
    }

    const label = _t("bridge|view_once_sent", { network: getBridgeNetworkName(room) });
    return (
        <Tooltip label={label}>
            {/* Focusable so keyboard users can reach the tooltip. */}
            {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
            <span className={className} tabIndex={0} aria-label={label}>
                {icon}
                {text}
            </span>
        </Tooltip>
    );
}
