/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { useEffect, useRef, useState } from "react";
import { ClientEvent, type MatrixClient, SyncState } from "matrix-js-sdk/src/matrix";

import { _t } from "../languageHandler";

/** tweb connectionStatus.ts CHANGE_STATE_DELAY: a status only appears after this long (no flicker). */
const STATUS_CHANGE_DELAY_MS = 400;

/**
 * What the connection is doing, as Telegram's chat list says it: "Waiting for network…" before the first
 * connection, "Reconnecting…" after losing it, "Updating…" while catching up, and nothing while connected.
 *
 * Telegram shows this in place of the list's title, so it needs no row of its own. A new status appears
 * only after a short delay (tweb's setState), so a blip does not flash one; clearing it is immediate once
 * one is showing.
 */
export function useConnectionStatus(client: MatrixClient | undefined): string | undefined {
    const [status, setStatus] = useState<string>();
    const hadConnect = useRef(false);

    useEffect(() => {
        if (!client) return;
        let timer: number | undefined;
        let shown: string | undefined;

        const compute = (): string | undefined => {
            const state = client.getSyncState();
            const offline = typeof navigator !== "undefined" && navigator.onLine === false;
            if (!offline && (state === SyncState.Syncing || state === SyncState.Prepared)) {
                hadConnect.current = true;
                return undefined;
            }
            if (!offline && state === SyncState.Catchup) return _t("tg_layout|connection_updating");
            if (!offline && (state === null || state === undefined)) return undefined; // not started yet
            return hadConnect.current ? _t("tg_layout|connection_reconnecting") : _t("tg_layout|connection_waiting");
        };
        const update = (): void => {
            const next = compute();
            window.clearTimeout(timer);
            const apply = (): void => {
                shown = next;
                setStatus(next);
            };
            if (shown) apply();
            else timer = window.setTimeout(apply, STATUS_CHANGE_DELAY_MS);
        };

        client.on(ClientEvent.Sync, update);
        window.addEventListener("online", update);
        window.addEventListener("offline", update);
        update();
        return () => {
            client.off(ClientEvent.Sync, update);
            window.removeEventListener("online", update);
            window.removeEventListener("offline", update);
            window.clearTimeout(timer);
        };
    }, [client]);

    return status;
}
