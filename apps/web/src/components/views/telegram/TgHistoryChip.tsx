/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useContext, useEffect, useState } from "react";

import CheckIcon from "@vector-im/compound-design-tokens/assets/web/icons/check";

import { _t } from "../../../languageHandler";
import MatrixClientContext from "../../../contexts/MatrixClientContext";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { UserTab } from "../dialogs/UserTab";
import { onBridgeStatusChange } from "../../../utils/chatHistory";
import { bridgeLoginsIn, type BridgeLogin, bridgesWithoutLoginState } from "../../../utils/bridgeLogins";
import { collectImports, importHeadline, type ImportOverview } from "../../../utils/importOverview";

/** What the bridges are up to, polled in one place so both chips read the same numbers. */
function useHistoryStatus(): ImportHeadline | undefined {
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
    if (!state) return undefined;
    return importHeadline(state.overview, state.logins);
}

/** Whether the bridges have nothing left to do: nothing blocked, nothing still coming in. */
function settled(headline: ImportHeadline): boolean {
    return headline.blocked === 0 && headline.open === 0;
}

/**
 * The one place, above the chat list, that says whether the bridges are working: a bridge that isn't
 * connected (with its name), else the history import's progress. Nothing when all is well and settled -
 * that state is carried by {@link HistoryStatusMini} instead, which takes almost no room.
 */
export function HistoryStatusChip(): JSX.Element | null {
    const headline = useHistoryStatus();
    if (!headline || settled(headline)) return null;

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

/**
 * What is left of the chip once the bridges are done: a tick beside the search row's Explore button.
 *
 * The full chip disappearing was the whole status disappearing with it, so there was no way to check
 * that everything had in fact come across, or to reach the import's details, without going looking in
 * settings. This keeps the answer one tap away while taking a button's worth of room.
 */
export function HistoryStatusMini(): JSX.Element | null {
    const headline = useHistoryStatus();
    if (!headline || !settled(headline) || headline.total === 0) return null;
    return (
        <button
            type="button"
            className="mx_TgHistoryChip_mini"
            title={_t("tg_layout|chip_all_imported", { count: headline.total.toLocaleString() })}
            aria-label={_t("tg_layout|chip_all_imported", { count: headline.total.toLocaleString() })}
            onClick={(): void => dis.dispatch({ action: Action.ViewUserSettings, initialTabId: UserTab.Bridges })}
        >
            <CheckIcon aria-hidden />
        </button>
    );
}
