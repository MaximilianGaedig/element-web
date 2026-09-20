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
import { SettingsSubsection } from "../../shared/SettingsSubsection";
import dis from "../../../../../dispatcher/dispatcher";
import { Action } from "../../../../../dispatcher/actions";
import { formatFullDateNoTime } from "../../../../../DateUtils";
import { BACKFILL_EVENT_TYPE, requestFullBackfill, requestSkipBackfill } from "../../../../../utils/chatHistory";
import {
    collectImports,
    type ImportEntry,
    type ImportOverview,
    type ImportSummary,
} from "../../../../../utils/importOverview";

const number = (n: number): string => n.toLocaleString();
const compact = (n: number): string =>
    new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n);

function eta(ms: number): string {
    const minutes = Math.max(1, Math.round(ms / 60_000));
    if (minutes < 60) return _t("tg_layout|history_eta_minutes", { count: minutes });
    const hours = Math.round(minutes / 6) / 10;
    if (hours < 48) return _t("tg_layout|history_eta_hours", { count: hours });
    return _t("tg_layout|history_eta_days", { count: Math.round(hours / 24) });
}

/** The overview, kept current: bridges write a chat's state as it changes, and a running import ages. */
function useOverview(): { overview?: ImportOverview } {
    const client = useContext(MatrixClientContext);
    const [overview, setOverview] = useState<ImportOverview | undefined>();
    useEffect(() => {
        if (!client) return;
        let timer: number | undefined;
        const refresh = (): void => {
            setOverview(collectImports(client));
        };
        const later = (): void => {
            // Many chats update at once: gather them into one pass.
            window.clearTimeout(timer);
            timer = window.setTimeout(refresh, 1000);
        };
        const onState = (event: { getType(): string }): void => {
            if (event.getType() === BACKFILL_EVENT_TYPE) later();
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
    return { overview };
}

function Bar({ value, tone }: { value: number; tone?: "done" }): JSX.Element {
    return (
        <span className={`mx_ImportBar${tone ? ` mx_ImportBar--${tone}` : ""}`} aria-hidden>
            <span style={{ width: `${Math.max(2, Math.min(100, Math.round(value * 100)))}%` }} />
        </span>
    );
}

/** What is going on, in the least space: all done is one verified line; otherwise the numbers that matter. */
function Summary({ overview }: { overview: ImportOverview }): JSX.Element {
    const open = overview.byPhase.importing + overview.byPhase.queued + overview.byPhase.paused;
    const doneChats = overview.byPhase.complete + overview.byPhase.unavailable + overview.byPhase.skipped;
    if (open === 0) {
        return (
            <details className="mx_ImportSummary mx_ImportSummary--done">
                <summary>
                    <span className="mx_ImportSummary_check" aria-hidden>
                        ✓
                    </span>
                    <span>
                        {_t("tg_layout|import_all_done", {
                            chats: number(overview.chats),
                            messages: number(overview.messages),
                        })}
                    </span>
                </summary>
                <NetworkList overview={overview} />
                {(overview.byPhase.skipped > 0 || overview.byPhase.unavailable > 0) && (
                    <p className="mx_ImportSummary_note">
                        {_t("tg_layout|import_done_notes", {
                            skipped: overview.byPhase.skipped,
                            unavailable: overview.byPhase.unavailable,
                        })}
                    </p>
                )}
            </details>
        );
    }

    const chatShare = overview.chats ? doneChats / overview.chats : 0;
    const messageShare = overview.countedTotal ? overview.countedImported / overview.countedTotal : undefined;
    return (
        <div className="mx_ImportSummary">
            <div className="mx_ImportSummary_title">{_t("tg_layout|import_running_title")}</div>
            <div className="mx_ImportSummary_metric">
                <span>{_t("tg_layout|import_chats", { done: number(doneChats), total: number(overview.chats) })}</span>
                <Bar value={chatShare} />
            </div>
            <div className="mx_ImportSummary_metric">
                <span>
                    {messageShare === undefined
                        ? _t("tg_layout|import_messages_only", { done: number(overview.messages) })
                        : _t("tg_layout|import_messages", {
                              done: number(overview.countedImported),
                              total: number(overview.countedTotal),
                          })}
                </span>
                {messageShare !== undefined && <Bar value={messageShare} />}
            </div>
            <p className="mx_ImportSummary_line">
                {[
                    overview.etaMs !== undefined
                        ? _t("tg_layout|history_eta", { time: eta(overview.etaMs) })
                        : undefined,
                    overview.ratePerMinute
                        ? _t("tg_layout|history_pace", { rate: number(Math.round(overview.ratePerMinute)) })
                        : undefined,
                ]
                    .filter(Boolean)
                    .join(" · ")}
            </p>
            <ul className="mx_ImportChips">
                {(["importing", "queued", "paused", "skipped"] as const).map(
                    (phase) =>
                        overview.byPhase[phase] > 0 && (
                            <li key={phase} className={`mx_ImportChips_chip mx_ImportChips_chip--${phase}`}>
                                {_t(`tg_layout|import_chip_${phase}`, { count: overview.byPhase[phase] })}
                            </li>
                        ),
                )}
            </ul>
        </div>
    );
}

function Row({
    entry,
    actions,
    showPhase,
}: {
    entry: ImportEntry;
    actions?: JSX.Element;
    showPhase?: boolean;
}): JSX.Element {
    const { room, status, phase } = entry;
    const fraction = status.remote_total ? Math.min(0.99, status.bridged_messages / status.remote_total) : undefined;
    return (
        <li className={`mx_ImportRow mx_ImportRow--${phase}`}>
            <button
                type="button"
                className="mx_ImportRow_main"
                onClick={(): void =>
                    dis.dispatch({ action: Action.ViewRoom, room_id: room.roomId, metricsTrigger: undefined })
                }
            >
                <span className="mx_ImportRow_name">{room.name}</span>
                <span className="mx_ImportRow_meta">
                    {showPhase && (
                        <span className={`mx_ImportRow_phase mx_ImportRow_phase--${phase}`}>
                            {_t(
                                `tg_layout|history_badge_${phase === "importing" ? "importing" : phase === "queued" ? "queued" : phase === "paused" ? "paused" : phase === "skipped" ? "skipped" : phase === "unavailable" ? "unavailable" : "complete"}`,
                            )}{" "}
                            ·{" "}
                        </span>
                    )}
                    {phase === "queued" && status.queue_ahead !== undefined
                        ? _t("tg_layout|import_queue_position", { position: status.queue_ahead + 1 })
                        : phase === "importing" && status.rate_per_min
                          ? _t("tg_layout|history_pace", { rate: number(Math.round(status.rate_per_min)) })
                          : status.oldest_ts
                            ? formatFullDateNoTime(new Date(status.oldest_ts))
                            : ""}
                </span>
                <span className="mx_ImportRow_count">
                    {status.remote_total
                        ? `${compact(status.bridged_messages)} / ${compact(status.remote_total)}`
                        : compact(status.bridged_messages)}
                </span>
                {fraction !== undefined && phase !== "skipped" && <Bar value={fraction} />}
            </button>
            {actions}
        </li>
    );
}

function Action_({ label, onClick }: { label: string; onClick: () => void }): JSX.Element {
    const [done, setDone] = useState(false);
    return (
        <button
            type="button"
            className="mx_ImportRow_action"
            disabled={done}
            onClick={(): void => {
                setDone(true);
                onClick();
            }}
        >
            {label}
        </button>
    );
}

const QUEUE_LIMIT = 30;

function Section({
    title,
    entries,
    action,
    limit,
}: {
    title: string;
    entries: ImportEntry[];
    action?: (entry: ImportEntry) => JSX.Element | undefined;
    limit?: number;
}): JSX.Element | null {
    if (!entries.length) return null;
    const shown = limit ? entries.slice(0, limit) : entries;
    return (
        <SettingsSubsection heading={`${title} · ${number(entries.length)}`}>
            <ul className="mx_ImportList">
                {shown.map((entry) => (
                    <Row key={entry.room.roomId} entry={entry} actions={action?.(entry)} />
                ))}
            </ul>
            {shown.length < entries.length && (
                <p className="mx_ImportSummary_note">
                    {_t("tg_layout|import_more", { count: entries.length - shown.length })}
                </p>
            )}
        </SettingsSubsection>
    );
}

function NetworkLine({
    network,
}: {
    network: ImportSummary & { network: string; entries: ImportEntry[] };
}): JSX.Element {
    const open = network.byPhase.importing + network.byPhase.queued + network.byPhase.paused;
    const rooms = [...network.entries].sort((a, b) => Number(a.phase === "complete") - Number(b.phase === "complete"));
    return (
        <details className="mx_ImportNetwork">
            <summary>
                <span className="mx_ImportNetwork_name">{network.network}</span>
                <span className="mx_ImportNetwork_stat">
                    {_t("tg_layout|import_chats", {
                        done: number(network.chats - open),
                        total: number(network.chats),
                    })}
                </span>
                <span className="mx_ImportNetwork_stat">{compact(network.messages)}</span>
                <span className="mx_ImportNetwork_state">
                    {open === 0 ? "✓" : network.etaMs !== undefined ? eta(network.etaMs) : "…"}
                </span>
            </summary>
            <p className="mx_ImportSummary_note">
                {network.countedChats > 0
                    ? _t("tg_layout|import_network_counted", {
                          done: number(network.countedImported),
                          total: number(network.countedTotal),
                          chats: network.countedChats,
                      })
                    : _t("tg_layout|import_network_uncounted")}
            </p>
            <ul className="mx_ImportList">
                {rooms.slice(0, 300).map((entry) => (
                    <Row key={entry.room.roomId} entry={entry} showPhase />
                ))}
            </ul>
        </details>
    );
}

function NetworkList({ overview }: { overview: ImportOverview }): JSX.Element {
    return (
        <div className="mx_ImportNetworks">
            {overview.networks.map((network) => (
                <NetworkLine key={network.network} network={network} />
            ))}
        </div>
    );
}

/**
 * Where every chat's history import stands: a summary (one verified line once all is imported), what is
 * importing now, the queue with each chat's place in it, chats needing a request or skipped on purpose,
 * and each network's totals.
 */
export default function ImportUserSettingsTab(): JSX.Element {
    const { overview } = useOverview();
    if (!overview) {
        return (
            <SettingsTab data-testid="mx_ImportUserSettingsTab">
                <SettingsSection>
                    <p className="mx_ImportSummary_note" role="status">
                        {_t("settings|storage|loading")}
                    </p>
                </SettingsSection>
            </SettingsTab>
        );
    }
    if (overview.chats === 0) {
        return (
            <SettingsTab data-testid="mx_ImportUserSettingsTab">
                <SettingsSection>
                    <p className="mx_ImportSummary_note">{_t("tg_layout|import_none")}</p>
                </SettingsSection>
            </SettingsTab>
        );
    }

    const by = (phase: ImportEntry["phase"]): ImportEntry[] => overview.entries.filter((e) => e.phase === phase);
    const paused = by("paused");
    return (
        <SettingsTab data-testid="mx_ImportUserSettingsTab">
            <SettingsSection>
                <Summary overview={overview} />
                <Section title={_t("tg_layout|import_now")} entries={by("importing")} action={skipAction} />
                <Section
                    title={_t("tg_layout|import_queue")}
                    entries={by("queued")}
                    action={skipAction}
                    limit={QUEUE_LIMIT}
                />
                <Section title={_t("tg_layout|import_paused")} entries={paused} action={importAction} />
                <Section title={_t("tg_layout|import_skipped")} entries={by("skipped")} action={importAction} />
                {overview.byPhase.importing + overview.byPhase.queued + overview.byPhase.paused > 0 && (
                    <SettingsSubsection heading={_t("tg_layout|import_networks")}>
                        <NetworkList overview={overview} />
                    </SettingsSubsection>
                )}
            </SettingsSection>
        </SettingsTab>
    );
}

function skipAction(entry: ImportEntry): JSX.Element | undefined {
    if (!entry.status.command_prefix) return undefined;
    return (
        <Action_
            label={_t("tg_layout|import_skip_short")}
            onClick={() => void requestSkipBackfill(entry.room, entry.status)}
        />
    );
}

function importAction(entry: ImportEntry): JSX.Element | undefined {
    if (!entry.status.command_prefix) return undefined;
    return (
        <Action_
            label={_t("tg_layout|import_start_short")}
            onClick={() => void requestFullBackfill(entry.room, entry.status)}
        />
    );
}
