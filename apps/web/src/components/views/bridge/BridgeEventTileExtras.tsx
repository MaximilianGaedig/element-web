/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";
import { type MatrixEvent } from "matrix-js-sdk/src/matrix";

import MessageSendStatus from "./MessageSendStatus";
import DisappearingMessageBadge from "./DisappearingMessageBadge";

interface Props {
    mxEvent: MatrixEvent;
    /** Called when a disappearing message's timer runs out. */
    onDisappeared?: () => void;
    /**
     * Telegram-style bubbles: the disappearing timer and the pending/delivered state live in the
     * bubble's time (TelegramTimeSlot), so only delivery failures are left to show here.
     */
    telegramTime?: boolean;
}

/**
 * Per-message decorations driven by mautrix bridge extensions, rendered under the message
 * body inside the event tile. Kept in one place so EventTile needs a single hook.
 */
export default function BridgeEventTileExtras({ mxEvent, onDisappeared, telegramTime }: Props): JSX.Element {
    if (telegramTime) return <MessageSendStatus mxEvent={mxEvent} failuresOnly />;
    return (
        <>
            <DisappearingMessageBadge mxEvent={mxEvent} onDisappeared={onDisappeared} />
            <MessageSendStatus mxEvent={mxEvent} />
        </>
    );
}
