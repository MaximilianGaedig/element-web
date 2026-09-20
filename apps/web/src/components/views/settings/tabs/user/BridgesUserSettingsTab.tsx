/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useContext, useEffect, useState } from "react";

import { _t } from "../../../../../languageHandler";
import MatrixClientContext from "../../../../../contexts/MatrixClientContext";
import BaseAvatar from "../../../avatars/BaseAvatar";
import { mediaFromMxc } from "../../../../../customisations/Media";
import SettingsTab from "../SettingsTab";
import { SettingsSection } from "../../shared/SettingsSection";
import dis from "../../../../../dispatcher/dispatcher";
import { Action } from "../../../../../dispatcher/actions";
import { TimelineRenderingType } from "../../../../../contexts/RoomContext";
import { onBridgeStatusChange } from "../../../../../utils/chatHistory";
import {
    bridgeLoginsIn,
    bridgesWithoutLoginState,
    type BridgeLogin,
    type LoginHealth,
} from "../../../../../utils/bridgeLogins";
import {
    collectImports,
    importHeadline,
    type ImportOverview,
    type NetworkSummary,
} from "../../../../../utils/importOverview";
import { Bar, eta, NetworkImportDetail, number as num } from "./importDetail";

const number = (n: number): string => n.toLocaleString();

/** A stable colour per network, so each bridge is recognisable at a glance. */
const HEALTH_GLYPH: Record<LoginHealth, string> = {
    connected: "✓",
    connecting: "↻",
    problem: "!",
    disconnected: "⏻",
    unreported: "?",
};

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
        const refresh = (): void => {
            const reporting = bridgeLoginsIn(client);
            setData({
                logins: [...reporting, ...bridgesWithoutLoginState(client, reporting)],
                overview: collectImports(client),
            });
        };
        // Many chats update at once: gather them into one pass.
        const later = (): void => {
            window.clearTimeout(timer);
            timer = window.setTimeout(refresh, 1000);
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

/** The bridge's own picture: its bot's avatar, from what the client already knows, else from the bot's profile. */
function useBotAvatar(login: BridgeLogin): string | undefined {
    const client = useContext(MatrixClientContext);
    const me = client.getSafeUserId();
    const botId = login.botId ?? login.room.getJoinedMembers().find((member) => member.userId !== me)?.userId;
    const known =
        (botId && (login.room.getMember(botId)?.getMxcAvatarUrl() ?? client.getUser(botId)?.avatarUrl)) || undefined;
    const [fetched, setFetched] = useState<string>();

    useEffect(() => {
        if (known || !botId) return;
        let cancelled = false;
        client
            .getProfileInfo(botId)
            .then((profile) => {
                if (!cancelled) setFetched(profile.avatar_url);
            })
            .catch(() => {});
        return (): void => {
            cancelled = true;
        };
    }, [client, botId, known]);

    const mxc = known ?? fetched;
    return mxc ? (mediaFromMxc(mxc, client).getSquareThumbnailHttp(80) ?? undefined) : undefined;
}

/** Everything being imported, across all the bridges: the line that used to be its own page. */
function OverallImport({ overview, logins }: { overview?: ImportOverview; logins: BridgeLogin[] }): JSX.Element | null {
    if (!overview || overview.chats === 0) return null;
    const headline = importHeadline(overview, logins);
    const open = headline.open + headline.blocked;
    if (open === 0) {
        return (
            <div className="mx_ImportSummary mx_ImportSummary--done">
                <span className="mx_ImportSummary_check" aria-hidden>
                    ✓
                </span>
                <span>
                    {_t("tg_layout|import_all_done", {
                        chats: num(overview.chats),
                        messages: num(overview.messages),
                    })}
                </span>
            </div>
        );
    }
    const share = overview.countedTotal ? overview.countedImported / overview.countedTotal : undefined;
    return (
        <div className="mx_ImportSummary">
            <div className="mx_ImportSummary_title">{_t("tg_layout|import_running_title")}</div>
            <div className="mx_ImportSummary_metric">
                <span>
                    {_t("tg_layout|import_chats", {
                        done: num(headline.done),
                        total: num(headline.total),
                    })}
                </span>
                <Bar value={headline.total ? headline.done / headline.total : 0} />
            </div>
            {headline.blocked > 0 && (
                <p className="mx_ImportSummary_note">
                    {_t("tg_layout|import_waiting_for_login", {
                        count: headline.blocked,
                        network: headline.blockedNetworks.join(", "),
                    })}
                </p>
            )}
            <div className="mx_ImportSummary_metric">
                <span>
                    {share === undefined
                        ? _t("tg_layout|import_messages_only", { done: num(overview.messages) })
                        : _t("tg_layout|import_messages", {
                              done: num(overview.countedImported),
                              total: num(overview.countedTotal),
                          })}
                </span>
                {share !== undefined && <Bar value={share} />}
            </div>
            {overview.etaMs !== undefined && (
                <p className="mx_ImportSummary_line">{_t("tg_layout|history_eta", { time: eta(overview.etaMs) })}</p>
            )}
        </div>
    );
}

function BridgeCard({
    login,
    network,
    overview,
}: {
    login: BridgeLogin;
    network?: NetworkSummary;
    overview?: ImportOverview;
}): JSX.Element {
    const avatar = useBotAvatar(login);
    const needsAction = login.health === "disconnected" || login.health === "problem";
    return (
        <details className={`mx_BridgeCard mx_BridgeCard--${login.health}`} open={needsAction || undefined}>
            <summary className="mx_BridgeCard_summary">
                <BaseAvatar
                    className="mx_BridgeCard_avatar"
                    name={login.network}
                    idName={login.network}
                    url={avatar}
                    size="40px"
                    type="round"
                />
                <span className="mx_BridgeCard_titles">
                    <span className="mx_BridgeCard_title">{login.network}</span>
                    <span className="mx_BridgeCard_subtitle">
                        {login.health === "unreported"
                            ? _t("tg_layout|bridge_unreported_hint")
                            : login.remoteName || login.accountId}
                    </span>
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

                {network && overview ? (
                    <NetworkImportDetail network={network} overview={overview} blocked={needsAction} />
                ) : (
                    <p className="mx_ImportSummary_note">
                        {_t("tg_layout|import_no_report", { network: login.network })}
                    </p>
                )}

                {login.health === "unreported" && (
                    <p className="mx_BridgeCard_note">
                        {_t("tg_layout|bridge_unreported_body", { network: login.network })}
                    </p>
                )}

                <dl className="mx_BridgeCard_facts">
                    {login.updatedTs > 0 && (
                        <div>
                            <dt>{_t("tg_layout|bridge_fact_updated")}</dt>
                            <dd>{ago(login.updatedTs)}</dd>
                        </div>
                    )}
                    {network && (
                        <div>
                            <dt>{_t("tg_layout|bridge_fact_messages")}</dt>
                            <dd>{number(network.messages)}</dd>
                        </div>
                    )}
                </dl>

                <div className="mx_BridgeCard_actions">
                    <button
                        type="button"
                        className="mx_BridgeCard_secondary"
                        onClick={(): void =>
                            dis.dispatch({
                                action: Action.ViewRoom,
                                room_id: login.room.roomId,
                                metricsTrigger: undefined,
                            })
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
                        <OverallImport overview={overview} logins={logins} />
                        <p className="mx_BridgesTab_summary">
                            {_t("tg_layout|bridges_summary", {
                                connected: logins.filter((l) => l.health === "connected").length,
                                total: logins.filter((l) => l.health !== "unreported").length,
                            })}
                            {logins.some((l) => l.health === "unreported") &&
                                ` · ${_t("tg_layout|bridges_not_reporting", {
                                    count: logins.filter((l) => l.health === "unreported").length,
                                })}`}
                        </p>
                        <div className="mx_BridgesTab_list">
                            {logins.map((login) => (
                                <BridgeCard
                                    key={`${login.room.roomId}${login.accountId}`}
                                    login={login}
                                    overview={overview}
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
