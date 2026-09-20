/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useContext, useEffect, useState } from "react";
import { RoomStateEvent } from "matrix-js-sdk/src/matrix";

import { _t } from "../../../languageHandler";
import MatrixClientContext from "../../../contexts/MatrixClientContext";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { UserTab } from "../dialogs/UserTab";
import { BACKFILL_EVENT_TYPE } from "../../../utils/chatHistory";
import { BRIDGE_LOGIN_EVENT_TYPE, bridgeLoginsIn, type BridgeLogin } from "../../../utils/bridgeLogins";
import { collectImports, type ImportOverview } from "../../../utils/importOverview";

/**
 * The one place, above the chat list, that says whether the bridges are working: a bridge that isn't
 * connected (with its name), else the history import's progress. Nothing when all is well and settled.
 * Tapping it opens the details (Settings > Chat history).
 */
export function HistoryStatusChip(): JSX.Element | null {
    const client = useContext(MatrixClientContext);
    const [state, setState] = useState<{ overview: ImportOverview; logins: BridgeLogin[] } | undefined>();
    useEffect(() => {
        if (!client) return;
        let timer: number | undefined;
        const refresh = (): void => setState({ overview: collectImports(client), logins: bridgeLoginsIn(client) });
        const later = (): void => {
            window.clearTimeout(timer);
            timer = window.setTimeout(refresh, 1500);
        };
        const onState = (event: { getType(): string }): void => {
            if (event.getType() === BACKFILL_EVENT_TYPE || event.getType() === BRIDGE_LOGIN_EVENT_TYPE) later();
        };
        refresh();
        client.on(RoomStateEvent.Events, onState);
        const tick = window.setInterval(refresh, 30_000);
        return (): void => {
            client.off(RoomStateEvent.Events, onState);
            window.clearInterval(tick);
            window.clearTimeout(timer);
        };
    }, [client]);
    if (!state) return null;

    const { overview, logins } = state;
    const broken = logins.filter((l) => l.health === "disconnected" || l.health === "problem");
    const open = overview.byPhase.importing + overview.byPhase.queued + overview.byPhase.paused;
    if (broken.length === 0 && open === 0) return null;

    const done = overview.chats - open;
    const percent = overview.countedTotal ? Math.min(99, Math.floor((overview.countedImported / overview.countedTotal) * 100)) : undefined;
    let text: string;
    let tone: "problem" | "working";
    if (broken.length) {
        tone = "problem";
        const names = broken.map((l) => l.network + (l.remoteName ? ` (${l.remoteName})` : "")).join(", ");
        text = _t("tg_layout|chip_login_problem", { count: broken.length, names });
    } else {
        tone = "working";
        text = _t("tg_layout|chip_importing", {
            done: done.toLocaleString(),
            total: overview.chats.toLocaleString(),
            percent: percent === undefined ? "" : ` · ${percent}%`,
        });
    }

    return (
        <button
            type="button"
            className={`mx_TgHistoryChip mx_TgHistoryChip--${tone}`}
            onClick={(): void =>
                dis.dispatch({ action: Action.ViewUserSettings, initialTabId: UserTab.Import })
            }
        >
            {tone === "working" && <span className="mx_HistoryPhaseIcon mx_HistoryPhaseIcon--spin mx_TgHistoryChip_spinner" aria-hidden />}
            {tone === "problem" && <span className="mx_TgHistoryChip_dot" aria-hidden />}
            <span className="mx_TgHistoryChip_text">{text}</span>
        </button>
    );
}
