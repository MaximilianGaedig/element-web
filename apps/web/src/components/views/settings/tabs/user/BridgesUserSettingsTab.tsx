/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useContext, useEffect, useState } from "react";
import { RoomStateEvent } from "matrix-js-sdk/src/matrix";

import { _t } from "../../../../../languageHandler";
import MatrixClientContext from "../../../../../contexts/MatrixClientContext";
import SettingsTab from "../SettingsTab";
import { SettingsSection } from "../../shared/SettingsSection";
import dis from "../../../../../dispatcher/dispatcher";
import { Action } from "../../../../../dispatcher/actions";
import { TimelineRenderingType } from "../../../../../contexts/RoomContext";
import { UserTab } from "../../../dialogs/UserTab";
import { BACKFILL_EVENT_TYPE } from "../../../../../utils/chatHistory";
import {
    BRIDGE_LOGIN_EVENT_TYPE,
    bridgeLoginsIn,
    type BridgeLogin,
    type LoginHealth,
} from "../../../../../utils/bridgeLogins";
import { collectImports, type ImportOverview, type NetworkSummary } from "../../../../../utils/importOverview";

const number = (n: number): string => n.toLocaleString();

/** A stable colour per network, so each bridge is recognisable at a glance. */
function networkHue(network: string): number {
    let hash = 0;
    for (const char of network) hash = (hash * 31 + char.charCodeAt(0)) % 360;
    return hash;
}

const HEALTH_GLYPH: Record<LoginHealth, string> = { connected: "✓", connecting: "↻", problem: "!", disconnected: "⏻" };

function ago(ts: number): string {
    if (!ts) return "";
    const seconds = Math.round((ts - Date.now()) / 1000);
    const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    const abs = Math.abs(seconds);
    if (abs < 60) return format.format(seconds, "second");
    if (abs < 3600) return format.format(Math.round(seconds / 60), "minute");
    if (abs < 86_400) return format.format(Math.round(seconds / 3600), "hour");
    return format.format(Math.round(seconds / 86_400), "day");
}

function useBridges(): { logins?: BridgeLogin[]; overview?: ImportOverview } {
    const client = useContext(MatrixClientContext);
    const [data, setData] = useState<{ logins: BridgeLogin[]; overview: ImportOverview } | undefined>();
    useEffect(() => {
        if (!client) return;
        let timer: number | undefined;
        const refresh = (): void => setData({ logins: bridgeLoginsIn(client), overview: collectImports(client) });
        const onState = (event: { getType(): string }): void => {
            if (event.getType() !== BACKFILL_EVENT_TYPE && event.getType() !== BRIDGE_LOGIN_EVENT_TYPE) return;
            window.clearTimeout(timer);
            timer = window.setTimeout(refresh, 1000);
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
    return data ?? {};
}

/** Takes you to the bridge's chat with the login command typed, ready to send. */
function openLogin(login: BridgeLogin): void {
    dis.dispatch({ action: Action.ViewRoom, room_id: login.room.roomId, metricsTrigger: undefined });
    window.setTimeout(() => {
        dis.dispatch({
            action: Action.ComposerInsert,
            text: `${login.commandPrefix} login`,
            timelineRenderingType: TimelineRenderingType.Room,
        });
    }, 500);
}

function ImportLine({ network }: { network: NetworkSummary }): JSX.Element {
    const open = network.byPhase.importing + network.byPhase.queued + network.byPhase.paused;
    const share = network.chats ? (network.chats - open) / network.chats : 0;
    return (
        <div className="mx_BridgeCard_import">
            <div className="mx_BridgeCard_importText">
                {open === 0
                    ? _t("tg_layout|bridge_all_imported", { chats: number(network.chats), messages: number(network.messages) })
                    : _t("tg_layout|import_chats", { done: number(network.chats - open), total: number(network.chats) })}
            </div>
            {open > 0 && (
                <span className="mx_ImportBar" aria-hidden>
                    <span style={{ width: `${Math.max(2, Math.round(share * 100))}%` }} />
                </span>
            )}
        </div>
    );
}

function BridgeCard({ login, network }: { login: BridgeLogin; network?: NetworkSummary }): JSX.Element {
    const needsAction = login.health === "disconnected" || login.health === "problem";
    return (
        <details className={`mx_BridgeCard mx_BridgeCard--${login.health}`} open={needsAction || undefined}>
            <summary className="mx_BridgeCard_summary">
                <span className="mx_BridgeCard_avatar" style={{ ["--hue" as string]: networkHue(login.network) }} aria-hidden>
                    {login.network.slice(0, 1).toUpperCase()}
                </span>
                <span className="mx_BridgeCard_titles">
                    <span className="mx_BridgeCard_title">{login.network}</span>
                    <span className="mx_BridgeCard_subtitle">{login.remoteName || login.accountId}</span>
                </span>
                <span className="mx_BridgeCard_status">
                    <span aria-hidden>{HEALTH_GLYPH[login.health]}</span>
                    {_t(`tg_layout|bridge_state_${login.health}`)}
                </span>
                <span className="mx_BridgeCard_chevron" aria-hidden>
                    ›
                </span>
            </summary>

            <div className="mx_BridgeCard_body">
                {needsAction && (
                    <div className="mx_BridgeCard_callout" role="alert">
                        <div className="mx_BridgeCard_calloutTitle">
                            {login.health === "disconnected"
                                ? _t("tg_layout|bridge_logged_out_title", { network: login.network })
                                : _t("tg_layout|bridge_problem_title", { network: login.network })}
                        </div>
                        {login.message && <p>{login.message}</p>}
                        <ol className="mx_BridgeCard_steps">
                            <li>{_t("tg_layout|bridge_step_open")}</li>
                            <li>{_t("tg_layout|bridge_step_login", { command: `${login.commandPrefix} login` })}</li>
                            <li>{_t("tg_layout|bridge_step_follow")}</li>
                        </ol>
                        <button type="button" className="mx_BridgeCard_primary" onClick={(): void => openLogin(login)}>
                            {_t("tg_layout|bridge_login_again")}
                        </button>
                    </div>
                )}

                {network && <ImportLine network={network} />}

                <dl className="mx_BridgeCard_facts">
                    <div>
                        <dt>{_t("tg_layout|bridge_fact_updated")}</dt>
                        <dd>{ago(login.updatedTs)}</dd>
                    </div>
                    {network && (
                        <div>
                            <dt>{_t("tg_layout|bridge_fact_messages")}</dt>
                            <dd>{number(network.messages)}</dd>
                        </div>
                    )}
                </dl>

                <div className="mx_BridgeCard_actions">
                    {network && network.chats > 0 && (
                        <button
                            type="button"
                            className="mx_BridgeCard_secondary"
                            onClick={(): void =>
                                dis.dispatch({ action: Action.ViewUserSettings, initialTabId: UserTab.Import })
                            }
                        >
                            {_t("tg_layout|bridge_see_import")}
                        </button>
                    )}
                    <button
                        type="button"
                        className="mx_BridgeCard_secondary"
                        onClick={(): void =>
                            dis.dispatch({ action: Action.ViewRoom, room_id: login.room.roomId, metricsTrigger: undefined })
                        }
                    >
                        {_t("tg_layout|bridge_open_chat")}
                    </button>
                </div>
            </div>
        </details>
    );
}

/**
 * Your bridges: which networks are connected as your account, what state each is in and what to do when
 * it isn't, and how far each one's history import is. An inset list of cards; a card that needs you is
 * open, one that is fine is a single row.
 */
export default function BridgesUserSettingsTab(): JSX.Element {
    const { logins, overview } = useBridges();
    return (
        <SettingsTab data-testid="mx_BridgesUserSettingsTab">
            <SettingsSection>
                {!logins && (
                    <p className="mx_BridgesTab_note" role="status">
                        {_t("settings|storage|loading")}
                    </p>
                )}
                {logins && logins.length === 0 && (
                    <div className="mx_BridgesTab_empty">
                        <div className="mx_BridgesTab_emptyTitle">{_t("tg_layout|bridges_empty_title")}</div>
                        <p>{_t("tg_layout|bridges_empty_body")}</p>
                    </div>
                )}
                {logins && logins.length > 0 && (
                    <>
                        <p className="mx_BridgesTab_summary">
                            {_t("tg_layout|bridges_summary", {
                                connected: logins.filter((l) => l.health === "connected").length,
                                total: logins.length,
                            })}
                        </p>
                        <div className="mx_BridgesTab_list">
                            {logins.map((login) => (
                                <BridgeCard
                                    key={`${login.room.roomId}${login.accountId}`}
                                    login={login}
                                    network={overview?.networks.find((n) => n.network === login.network)}
                                />
                            ))}
                        </div>
                    </>
                )}
            </SettingsSection>
        </SettingsTab>
    );
}
