/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useContext, useEffect, useState } from "react";

import { _t } from "../../../languageHandler";
import MatrixClientContext from "../../../contexts/MatrixClientContext";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { UserTab } from "../dialogs/UserTab";
import { onBridgeStatusChange } from "../../../utils/chatHistory";
import { bridgeLoginsIn, type BridgeLogin, bridgesWithoutLoginState } from "../../../utils/bridgeLogins";
import { collectImports, importHeadline, type ImportOverview } from "../../../utils/importOverview";

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
        const refresh = (): void => {
            const reporting = bridgeLoginsIn(client);
            setState({
                overview: collectImports(client),
                logins: [...reporting, ...bridgesWithoutLoginState(client, reporting)],
            });
        };
        const later = (): void => {
            window.clearTimeout(timer);
            timer = window.setTimeout(refresh, 1500);
        };
        refresh();
        const stop = onBridgeStatusChange(client, later);
        const tick = window.setInterval(refresh, 30_000);
        return (): void => {
            stop();
            window.clearInterval(tick);
            window.clearTimeout(timer);
        };
    }, [client]);
    if (!state) return null;

    const { overview, logins } = state;
    const headline = importHeadline(overview, logins);
    if (headline.blocked === 0 && headline.open === 0) return null;

    // A bridge that needs you comes first: those chats are not moving at all until it is logged in.
    const tone: "problem" | "working" = headline.blocked > 0 ? "problem" : "working";
    const text =
        tone === "problem"
            ? _t("tg_layout|chip_login_problem", {
                  count: headline.blockedNetworks.length,
                  names: headline.blockedNetworks.join(", "),
              })
            : _t("tg_layout|chip_importing", {
                  done: headline.done.toLocaleString(),
                  total: headline.total.toLocaleString(),
              });

    return (
        <button
            type="button"
            className={`mx_TgHistoryChip mx_TgHistoryChip--${tone}`}
            onClick={(): void =>
                dis.dispatch({
                    action: Action.ViewUserSettings,
                    // A bridge that needs you comes first; otherwise the import's progress.
                    initialTabId: UserTab.Bridges,
                })
            }
        >
            {tone === "working" && (
                <span className="mx_HistoryPhaseIcon mx_HistoryPhaseIcon--spin mx_TgHistoryChip_spinner" aria-hidden />
            )}
            {tone === "problem" && <span className="mx_TgHistoryChip_dot" aria-hidden />}
            <span className="mx_TgHistoryChip_text">{text}</span>
            {tone === "working" && headline.percent !== undefined && (
                <span className="mx_TgHistoryChip_percent">{`${headline.percent}%`}</span>
            )}
        </button>
    );
}
