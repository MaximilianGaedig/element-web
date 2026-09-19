/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";
import { type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { InfoIcon, VideoCallSolidIcon, VoiceCallSolidIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import { getActionMessage } from "../../../utils/bridge/actionMessage";

interface Props {
    mxEvent: MatrixEvent;
}

/**
 * Renders a com.beeper.action_message (e.g. "Missed voice call" bridged from WhatsApp/Signal) as a
 * compact system line with an icon instead of a regular chat bubble. The text is the bridge's body.
 */
export default function ActionMessage({ mxEvent }: Props): JSX.Element {
    const action = getActionMessage(mxEvent);
    const body = mxEvent.getContent().body;
    let icon: JSX.Element;
    if (action?.type === "call") {
        icon =
            action.call_type === "video" ? (
                <VideoCallSolidIcon width="16" height="16" aria-hidden />
            ) : (
                <VoiceCallSolidIcon width="16" height="16" aria-hidden />
            );
    } else {
        icon = <InfoIcon width="16" height="16" aria-hidden />;
    }
    return (
        <div className="mx_ActionMessage mx_TextualEvent" data-action-type={action?.type}>
            {icon}
            <span dir="auto">{typeof body === "string" ? body : ""}</span>
        </div>
    );
}
