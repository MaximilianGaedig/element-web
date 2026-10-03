/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, type ReactNode, useContext, useEffect, useState } from "react";
import { type EventStatus, type MatrixEvent } from "matrix-js-sdk/src/matrix";

import TelegramTime from "./TelegramTime";
import DisappearingMessageBadge from "../bridge/DisappearingMessageBadge";
import ViewOnceBadge from "../bridge/ViewOnceBadge";
import { useMessageSendStatus } from "../bridge/MessageSendStatus";
import { getTelegramSendState, getTelegramTimePlacement } from "../../../utils/telegram/telegramTime";
import MatrixClientContext from "../../../contexts/MatrixClientContext";
import { bridgeHealthOf } from "../../../utils/bridgeLogins";
import { onBridgeStatusChange } from "../../../utils/chatHistory";
import { deleteFailed, resendFailed, useFailedSends } from "../../../utils/room/failedSends";
import { useAcceptedByBridge, useReadByOthers } from "../../../utils/telegram/readByOthers";

/**
 * Whether this event's room comes through a bridge that says it is not connected.
 *
 * Watched rather than read once: a bridge that drops while the timeline is open should change what
 * the messages under it claim, and one that comes back should change it straight back.
 */
function useBridgeDown(mxEvent: MatrixEvent): boolean {
    const client = useContext(MatrixClientContext);
    const roomId = mxEvent.getRoomId();
    const [down, setDown] = useState(false);
    useEffect(() => {
        const room = roomId ? client?.getRoom(roomId) : undefined;
        if (!client || !room) return;
        const read = (): void => {
            const health = bridgeHealthOf(client, room);
            setDown(health === "disconnected" || health === "problem");
        };
        read();
        return onBridgeStatusChange(client, read);
    }, [client, roomId]);
    return down;
}

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
    const bridgeDown = useBridgeDown(mxEvent);
    const client = useContext(MatrixClientContext);
    const room = client?.getRoom(mxEvent.getRoomId());
    // Anything of yours about this message that failed - the message, an edit, its deletion, a
    // reaction, a thread reply - puts Telegram's "!" on it, on others' messages too (a reaction).
    const failed = useFailedSends(mxEvent, room);
    // Worked out here, from the room, so it holds in the new timeline too, which never passed it in.
    const readFromRoom = useReadByOthers(room, mxEvent, isOwnEvent && !readByOthers);
    const bridgeAccepted = useAcceptedByBridge(room, mxEvent, isOwnEvent && bridgeDown && !bridgeStatus);
    const sendState =
        failed.length > 0
            ? "error"
            : isOwnEvent
              ? getTelegramSendState({
                    eventSendStatus,
                    bridgeStatus: bridgeStatus?.status,
                    bridgeDelivered: !!bridgeStatus?.delivered_to_users?.length,
                    bridgeAccepted,
                    readByOthers: readByOthers || readFromRoom,
                    bridgeDown,
                })
              : undefined;
    const onFailed =
        room && failed.length > 0
            ? { resend: () => resendFailed(room, failed), delete: () => deleteFailed(room, failed) }
            : undefined;
    return (
        <TelegramTime
            timestamp={timestamp}
            sendState={sendState}
            onFailed={onFailed}
            placement={getTelegramTimePlacement(mxEvent)}
            parts={
                <>
                    <ViewOnceBadge mxEvent={mxEvent} />
                    <DisappearingMessageBadge mxEvent={mxEvent} onDisappeared={onDisappeared} />
                </>
            }
        />
    );
}
