/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { IconButton } from "@vector-im/compound-web";
import CheckIcon from "@vector-im/compound-design-tokens/assets/web/icons/check";

import { _t } from "../../../languageHandler";
import MatrixClientContext from "../../../contexts/MatrixClientContext";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { UserTab } from "../dialogs/UserTab";
import { onBridgeStatusChange } from "../../../utils/chatHistory";
import { bridgeLoginsIn, type BridgeLogin, bridgesWithoutLoginState } from "../../../utils/bridgeLogins";
import {
    collectImports,
    importHeadline,
    type ImportHeadline,
    type ImportOverview,
} from "../../../utils/importOverview";

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

/** Whether the bridges have nothing left to do: nobody to log in again, nothing still coming in. */
function settled(headline: ImportHeadline): boolean {
    return headline.attention.length === 0 && headline.open === 0;
}

/*
 * Whether the settled status has been opened back out of its tick. Held here rather than in either
 * component because the two are in different places - the chip above the column, the tick in the list's
 * header - and one has to be able to open the other.
 */
let opened = false;
const listeners = new Set<() => void>();

export function setHistoryStatusOpen(next: boolean): void {
    if (next === opened) return;
    opened = next;
    // A copy, not the set: a listener may unsubscribe while being told.
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

const isOpen = (): boolean => opened;
const useHistoryStatusOpen = (): boolean => useSyncExternalStore(subscribe, isOpen, isOpen);

/** Where the import has got to, in the one line the chip has for it; nothing where nothing is bridged. */
function importLine(headline: ImportHeadline): string | undefined {
    if (headline.total === 0) return undefined;
    // Written out at each call: the i18n check reads the substitutions off the call itself.
    const done = headline.done.toLocaleString();
    const total = headline.total.toLocaleString();
    if (headline.open > 0) return _t("tg_layout|chip_importing", { done, total });
    // Everything that is left waits on a bridge that is not connected: nothing is being imported.
    if (headline.blocked > 0) return _t("tg_layout|chip_import_paused", { done, total });
    return _t("tg_layout|chip_all_imported", { count: headline.total });
}

/**
 * The one place, above the chat list, that says whether the bridges are working: a bridge that isn't
 * connected (with its name) and where the import has got to. Once all is well and settled it minimises
 * into {@link HistoryStatusMini}, which takes almost no room and opens it again.
 */
export function HistoryStatusChip(): JSX.Element | null {
    const headline = useHistoryStatus();
    const open = useHistoryStatusOpen();
    const busy = !!headline && !settled(headline);
    /*
     * Opened from the tick is a look at a finished import. Once there is something to say again the
     * chip is up on its own account, and when that is over it minimises as it would have anyway.
     */
    useEffect(() => {
        if (busy) setHistoryStatusOpen(false);
    }, [busy]);
    if (!headline) return null;
    if (!busy && !(open && headline.total > 0)) return null;

    // A bridge that needs you comes first: those chats are not moving at all until it is logged in.
    const tone: "problem" | "working" | "done" =
        headline.attention.length > 0 ? "problem" : headline.open > 0 ? "working" : "done";
    const problem =
        tone === "problem"
            ? _t("tg_layout|chip_login_problem", {
                  count: headline.attention.length,
                  names: headline.attention.join(", "),
              })
            : undefined;
    const progress = importLine(headline);
    // The share of an import that is still going; a finished one is capped at 99, which says nothing.
    const percent = headline.open + headline.blocked > 0 ? headline.percent : undefined;

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
            {tone === "done" && <CheckIcon className="mx_TgHistoryChip_check" aria-hidden />}
            {/*
             * What needs you, then where the import is up to - each on a line of its own. As one line
             * the two were wider than the column, and the import was the half the ellipsis took: a
             * bridge that was not connected showed nothing of its import at all.
             */}
            <span className="mx_TgHistoryChip_text">
                {problem && <span className="mx_TgHistoryChip_line">{problem}</span>}
                {progress && (
                    <span
                        className={
                            problem ? "mx_TgHistoryChip_line mx_TgHistoryChip_line--second" : "mx_TgHistoryChip_line"
                        }
                    >
                        {progress}
                    </span>
                )}
            </span>
            {percent !== undefined && <span className="mx_TgHistoryChip_percent">{`${percent}%`}</span>}
        </button>
    );
}

/**
 * What is left of the chip once the bridges are done: a tick in the room list's header, beside the
 * list's own buttons (where the search row and its Explore button used to be), that opens the chip
 * back out and closes it again.
 *
 * The full chip disappearing was the whole status disappearing with it, so there was no way to check
 * that everything had in fact come across, or to reach the import's details, without going looking in
 * settings. This keeps the answer one tap away while taking a button's worth of room.
 */
export function HistoryStatusMini(): JSX.Element | null {
    const headline = useHistoryStatus();
    const open = useHistoryStatusOpen();
    if (!headline || !settled(headline) || headline.total === 0) return null;
    return (
        <IconButton
            // The size and padding of the buttons it sits with, so the row keeps its height and rhythm.
            size="28px"
            style={{ padding: "4px" }}
            className="mx_TgHistoryChip_mini"
            tooltip={_t("tg_layout|chip_all_imported", { count: headline.total })}
            aria-expanded={open}
            onClick={(): void => setHistoryStatusOpen(!open)}
        >
            <CheckIcon color="var(--cpd-color-icon-success-primary)" aria-hidden />
        </IconButton>
    );
}
