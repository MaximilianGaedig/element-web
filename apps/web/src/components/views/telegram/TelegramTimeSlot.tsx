/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, type ReactNode } from "react";
import { type EventStatus, type MatrixEvent } from "matrix-js-sdk/src/matrix";

import TelegramTime from "./TelegramTime";
import DisappearingMessageBadge from "../bridge/DisappearingMessageBadge";
import { useMessageSendStatus } from "../bridge/MessageSendStatus";
import { getTelegramSendState, getTelegramTimePlacement } from "../../../utils/telegram/telegramTime";

interface Props {
    mxEvent: MatrixEvent;
    /** Element's timestamp element. */
    timestamp: ReactNode;
    /** Whether the event is ours: only our messages get a sending status, as in tweb. */
    isOwnEvent: boolean;
    eventSendStatus?: EventStatus;
    /** Whether someone else has read up to this event (only passed with Telegram ticks on). */
    readByOthers?: boolean;
    /** Called when a disappearing message's timer runs out. */
    onDisappeared?: () => void;
}

/** The Telegram-style time of one event tile, with its sending status and disappearing timer. */
export default function TelegramTimeSlot({
    mxEvent,
    timestamp,
    isOwnEvent,
    eventSendStatus,
    readByOthers,
    onDisappeared,
}: Props): JSX.Element {
    const bridgeStatus = useMessageSendStatus(mxEvent);
    const sendState = isOwnEvent
        ? getTelegramSendState({
              eventSendStatus,
              bridgeStatus: bridgeStatus?.status,
              bridgeDelivered: !!bridgeStatus?.delivered_to_users?.length,
              readByOthers,
          })
        : undefined;
    return (
        <TelegramTime
            timestamp={timestamp}
            sendState={sendState}
            placement={getTelegramTimePlacement(mxEvent)}
            parts={<DisappearingMessageBadge mxEvent={mxEvent} onDisappeared={onDisappeared} />}
        />
    );
}
