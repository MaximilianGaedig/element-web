/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useCallback, useContext, useEffect, useState } from "react";
import { type MatrixEvent, RoomEvent } from "matrix-js-sdk/src/matrix";
import { Tooltip } from "@vector-im/compound-web";
import { TimeIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import MatrixClientContext from "../../../contexts/MatrixClientContext";
import { useTypedEventEmitterState } from "../../../hooks/useEventEmitter";
import { _t } from "../../../languageHandler";
import {
    formatDisappearingDuration,
    getDisappearingExpiry,
    getEventDisappearingTimer,
} from "../../../utils/bridge/disappearingMessages";

interface Props {
    mxEvent: MatrixEvent;
    /** Called once when the message's timer runs out, so the tile can hide itself. */
    onDisappeared?: () => void;
}

/**
 * A small timer badge on messages that will disappear (com.beeper.disappearing_timer in the content):
 * the time left once the timer runs, otherwise the configured duration and when it starts.
 */
export default function DisappearingMessageBadge({ mxEvent, onDisappeared }: Props): JSX.Element | null {
    const client = useContext(MatrixClientContext);
    const room = client?.getRoom(mxEvent.getRoomId()) ?? null;
    const timer = getEventDisappearingTimer(mxEvent);
    const myUserId = client?.getSafeUserId() ?? "";

    // Receipts start after_read timers, so recompute the expiry when they change.
    const computeExpiry = useCallback(
        () => (timer ? getDisappearingExpiry(mxEvent, room, myUserId) : undefined),
        [timer, mxEvent, room, myUserId],
    );
    const expiry = useTypedEventEmitterState(room ?? undefined, RoomEvent.Receipt, computeExpiry);

    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (expiry === undefined) return;
        const left = expiry - Date.now();
        if (left <= 0) {
            onDisappeared?.();
            return;
        }
        // Tick every second in the last minute, otherwise every 30s (and exactly at expiry).
        const delay = left <= 60_000 ? 1000 : Math.min(30_000, left);
        const id = window.setTimeout(() => setNow(Date.now()), delay);
        return () => window.clearTimeout(id);
    }, [expiry, now, onDisappeared]);

    if (!timer) return null;

    let label: string;
    let text: string;
    if (expiry !== undefined) {
        const left = formatDisappearingDuration(expiry - now);
        label = _t("bridge|disappearing_in", { duration: left });
        text = left;
    } else {
        const duration = formatDisappearingDuration(timer.timer);
        label = _t("bridge|disappearing_after_read", { duration });
        text = duration;
    }

    return (
        <Tooltip label={label}>
            {/* Focusable so keyboard users can reach the tooltip. */}
            {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
            <span className="mx_DisappearingMessageBadge" tabIndex={0} aria-label={label}>
                <TimeIcon width="12" height="12" aria-hidden />
                {text}
            </span>
        </Tooltip>
    );
}
