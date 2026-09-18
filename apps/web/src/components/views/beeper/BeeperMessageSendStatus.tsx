/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useCallback, useContext, useState, useSyncExternalStore } from "react";
import { type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { Tooltip } from "@vector-im/compound-web";
import {
    CheckCircleSolidIcon,
    ErrorSolidIcon,
    RestartIcon,
    TimeIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";
import { logger } from "matrix-js-sdk/src/logger";

import MatrixClientContext from "../../../contexts/MatrixClientContext";
import AccessibleButton from "../elements/AccessibleButton";
import { _t } from "../../../languageHandler";
import {
    type MessageSendStatus,
    MessageSendStatusStore,
    retryFailedMessage,
} from "../../../utils/beeper/messageSendStatus";

/** Subscribes to the bridge-reported send status of an event. */
export function useMessageSendStatus(mxEvent: MatrixEvent): MessageSendStatus | undefined {
    const client = useContext(MatrixClientContext);
    const eventId = mxEvent.getId() ?? "";
    const roomId = mxEvent.getRoomId();
    const store = client ? MessageSendStatusStore.forClient(client) : undefined;
    const subscribe = useCallback(
        (listener: () => void) => (store ? store.subscribe(eventId, listener) : () => {}),
        [store, eventId],
    );
    return useSyncExternalStore(subscribe, () => store?.get(eventId, roomId));
}

function failureText(status: MessageSendStatus): string {
    const network = status.network || _t("beeper|send_status_remote_network");
    if (status.message) return _t("beeper|send_status_failed_with_message", { network, message: status.message });
    switch (status.reason) {
        case "com.beeper.unsupported_event":
            return _t("beeper|send_status_failed_unsupported", { network });
        case "m.event_too_old":
            return _t("beeper|send_status_failed_too_old", { network });
        case "m.no_permission":
            return _t("beeper|send_status_failed_no_permission", { network });
        case "m.bridge_unavailable":
            return _t("beeper|send_status_failed_bridge_unavailable", { network });
        default:
            return _t("beeper|send_status_failed", { network });
    }
}

interface Props {
    mxEvent: MatrixEvent;
}

/**
 * Shows what the bridge reported about delivering one of our messages to the remote network
 * (com.beeper.message_send_status): pending, delivered, or failed (with a retry button when the
 * bridge says a retry may work). Renders nothing for events without a status.
 */
export default function BeeperMessageSendStatus({ mxEvent }: Props): JSX.Element | null {
    const client = useContext(MatrixClientContext);
    const status = useMessageSendStatus(mxEvent);
    const [retrying, setRetrying] = useState(false);

    const onRetry = useCallback(async () => {
        setRetrying(true);
        try {
            await retryFailedMessage(client, mxEvent);
        } catch (e) {
            logger.warn("Failed to retry message", e);
            setRetrying(false);
        }
    }, [client, mxEvent]);

    if (!status || mxEvent.getSender() !== client?.getUserId()) return null;
    const network = status.network || _t("beeper|send_status_remote_network");

    if (status.status === "PENDING") {
        return (
            <Tooltip label={status.message ?? _t("beeper|send_status_pending", { network })}>
                <span className="mx_BeeperSendStatus mx_BeeperSendStatus_pending" role="status" tabIndex={0}>
                    <TimeIcon width="14" height="14" aria-hidden />
                </span>
            </Tooltip>
        );
    }

    if (status.status === "SUCCESS") {
        // A plain success adds nothing to Element's own sent/read indicators.
        if (!status.delivered_to_users?.length) return null;
        return (
            <Tooltip label={_t("beeper|send_status_delivered", { network })}>
                <span className="mx_BeeperSendStatus mx_BeeperSendStatus_delivered" role="status" tabIndex={0}>
                    <CheckCircleSolidIcon width="14" height="14" aria-hidden />
                </span>
            </Tooltip>
        );
    }

    const retriable = status.status === "FAIL_RETRIABLE";
    return (
        <div className="mx_BeeperSendStatus mx_BeeperSendStatus_failed" role="status">
            <ErrorSolidIcon width="16" height="16" aria-hidden />
            <span className="mx_BeeperSendStatus_text">{failureText(status)}</span>
            {retriable && (
                <AccessibleButton
                    kind="link_inline"
                    className="mx_BeeperSendStatus_retry"
                    onClick={onRetry}
                    disabled={retrying}
                >
                    <RestartIcon width="14" height="14" aria-hidden />
                    {retrying ? _t("beeper|send_status_retrying") : _t("beeper|send_status_retry")}
                </AccessibleButton>
            )}
        </div>
    );
}
