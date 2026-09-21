/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * How far one bridge has got importing your history, shown inside that bridge's card on the Bridges page:
 * its own progress, what it is importing right now, what waits in its queue and when each chat's turn is
 * expected. Each bridge imports on its own, one chat at a time, so every number here is per bridge - a
 * chat is never "behind" another network's chats, and a chat whose bridge is logged out is not queued at
 * all but waiting for you.
 */

import React, { type JSX, useState } from "react";

import { _t, _td } from "../../../../../languageHandler";
import dis from "../../../../../dispatcher/dispatcher";
import { Action } from "../../../../../dispatcher/actions";
import { formatFullDateNoTime } from "../../../../../DateUtils";
import { type HistoryPhase, requestFullBackfill, requestSkipBackfill } from "../../../../../utils/chatHistory";
import {
    estimateQueued,
    type ImportEntry,
    type ImportOverview,
    type NetworkSummary,
} from "../../../../../utils/importOverview";

export const number = (n: number): string => n.toLocaleString();
export const compact = (n: number): string =>
    new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n);

/** A rough duration, in the largest unit that still says something useful. */
export function eta(ms: number): string {
    const minutes = Math.max(1, Math.round(ms / 60_000));
    if (minutes < 60) return _t("tg_layout|history_eta_minutes", { count: minutes });
    const hours = Math.round(minutes / 6) / 10;
    if (hours < 48) return _t("tg_layout|history_eta_hours", { count: hours });
    return _t("tg_layout|history_eta_days", { count: Math.round(hours / 24) });
}

export function Bar({ value, tone }: { value: number; tone?: "done" }): JSX.Element {
    return (
        <span className={`mx_ImportBar${tone === "done" ? " mx_ImportBar--done" : ""}`} aria-hidden>
            <span style={{ width: `${Math.max(2, Math.round(value * 100))}%` }} />
        </span>
    );
}

/*
 * Spelled out rather than built from the phase: the string generator only sees keys that appear whole
 * in the source, and deletes any it cannot find.
 */
const PHASE_BADGE: Record<HistoryPhase, TranslationKey> = {
    importing: _td("tg_layout|history_badge_importing"),
    queued: _td("tg_layout|history_badge_queued"),
    paused: _td("tg_layout|history_badge_paused"),
    skipped: _td("tg_layout|history_badge_skipped"),
    unavailable: _td("tg_layout|history_badge_unavailable"),
    complete: _td("tg_layout|history_badge_complete"),
};

function Row({
    entry,
    actions,
    showPhase,
    note,
}: {
    entry: ImportEntry;
    actions?: JSX.Element;
    showPhase?: boolean;
    /** Replaces the usual meta line, e.g. when a waiting chat's turn is expected. */
    note?: string;
}): JSX.Element {
    const { room, status, phase } = entry;
    const fraction = status.remote_total ? Math.min(0.99, status.bridged_messages / status.remote_total) : undefined;
    const meta =
        note ??
        (phase === "queued" && status.queue_ahead !== undefined
            ? _t("tg_layout|import_queue_position", { position: status.queue_ahead + 1 })
            : phase === "importing" && status.rate_per_min
              ? _t("tg_layout|history_pace", { rate: number(Math.round(status.rate_per_min)) })
              : status.oldest_ts
                ? formatFullDateNoTime(new Date(status.oldest_ts))
                : "");
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
                            {_t(PHASE_BADGE[phase])} ·{" "}
                        </span>
                    )}
                    {meta}
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

function RowAction({ label, onClick }: { label: string; onClick: () => void }): JSX.Element {
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

function skipAction(entry: ImportEntry): JSX.Element | undefined {
    if (!entry.status.command_prefix) return undefined;
    return (
        <RowAction
            label={_t("tg_layout|import_skip_short")}
            onClick={() => void requestSkipBackfill(entry.room, entry.status)}
        />
    );
}

function importAction(entry: ImportEntry): JSX.Element | undefined {
    if (!entry.status.command_prefix) return undefined;
    return (
        <RowAction
            label={_t("tg_layout|import_start_short")}
            onClick={() => void requestFullBackfill(entry.room, entry.status)}
        />
    );
}

/** How many chats a group shows before the rest go behind a disclosure, so no card grows without end. */
const PREVIEW = 3;

function ChatList({
    entries,
    action,
    label,
}: {
    entries: ImportEntry[];
    action?: (entry: ImportEntry) => JSX.Element | undefined;
    label?: (entry: ImportEntry) => string | undefined;
}): JSX.Element | null {
    if (!entries.length) return null;
    const rows = (list: ImportEntry[]): JSX.Element[] =>
        list.map((entry) => (
            <Row key={entry.room.roomId} entry={entry} actions={action?.(entry)} note={label?.(entry)} />
        ));
    const rest = entries.slice(PREVIEW);
    return (
        <>
            <ul className="mx_ImportList">{rows(entries.slice(0, PREVIEW))}</ul>
            {rest.length > 0 && (
                <details className="mx_ImportMore">
                    <summary>{_t("tg_layout|import_show_all", { count: rest.length })}</summary>
                    <ul className="mx_ImportList">{rows(rest)}</ul>
                </details>
            )}
        </>
    );
}

/**
 * One bridge's import detail. `blocked` says its chats are waiting on you (it is logged out), in which
 * case they are not queued behind anything and no estimate is offered.
 */
export function NetworkImportDetail({
    network,
    overview,
    blocked,
}: {
    network: NetworkSummary;
    overview: ImportOverview;
    blocked?: boolean;
}): JSX.Element {
    const importing = network.entries.filter((e) => e.phase === "importing");
    const queued = network.entries.filter((e) => e.phase === "queued");
    const paused = network.entries.filter((e) => e.phase === "paused");
    const skipped = network.entries.filter((e) => e.phase === "skipped");
    const doneChats = network.byPhase.complete + network.byPhase.unavailable + network.byPhase.skipped;
    const open = importing.length + queued.length + paused.length;
    const messageShare = network.countedTotal ? network.countedImported / network.countedTotal : undefined;

    return (
        <div className="mx_ImportDetail">
            <div className="mx_ImportSummary_metric">
                <span>{_t("tg_layout|import_chats", { done: number(doneChats), total: number(network.chats) })}</span>
                <Bar value={network.chats ? doneChats / network.chats : 0} tone={open === 0 ? "done" : undefined} />
            </div>
            <div className="mx_ImportSummary_metric">
                <span>
                    {messageShare === undefined
                        ? _t("tg_layout|import_messages_only", { done: number(network.messages) })
                        : _t("tg_layout|import_messages", {
                              done: number(network.countedImported),
                              total: number(network.countedTotal),
                          })}
                </span>
                {messageShare !== undefined && <Bar value={messageShare} />}
            </div>

            {open === 0 &&
                !blocked && (
                    // Said plainly, because "62 of 63" with nothing running is not an answer to "is it done".
                    // What can be claimed differs by network: where the other side says how many messages a
                    // chat holds, every one of them is accounted for; where it does not, all that can be
                    // said is that it stopped offering older ones.
                    <p className="mx_ImportSummary_line mx_ImportSummary_line--done">
                        {messageShare === undefined
                            ? _t("tg_layout|import_all_done_uncounted", {
                                  messages: number(network.messages),
                                  chats: number(network.chats),
                                  network: network.network,
                              })
                            : _t("tg_layout|import_all_done", {
                                  messages: number(network.countedImported),
                                  chats: number(network.chats),
                              })}
                    </p>
                )}

            {open > 0 && !blocked && (
                <p className="mx_ImportSummary_line">
                    {[
                        network.etaMs !== undefined
                            ? _t("tg_layout|history_eta", { time: eta(network.etaMs) })
                            : undefined,
                        network.ratePerMinute
                            ? _t("tg_layout|history_pace", { rate: number(Math.round(network.ratePerMinute)) })
                            : undefined,
                        network.countedChats === 0 ? _t("tg_layout|import_network_uncounted") : undefined,
                    ]
                        .filter(Boolean)
                        .join(" · ")}
                </p>
            )}

            {importing.length > 0 && (
                <div className="mx_ImportDetail_group">
                    <h4>{_t("tg_layout|import_now")}</h4>
                    <ChatList entries={importing} action={skipAction} />
                </div>
            )}
            {queued.length > 0 && (
                <div className="mx_ImportDetail_group">
                    <h4>{`${_t("tg_layout|import_queue")} · ${number(queued.length)}`}</h4>
                    <ChatList
                        entries={queued}
                        action={skipAction}
                        label={(entry): string | undefined => {
                            if (blocked) return undefined;
                            const { waitMs } = estimateQueued(overview, entry.room.roomId);
                            return waitMs === undefined
                                ? undefined
                                : _t("tg_layout|history_in_time", { time: eta(waitMs) });
                        }}
                    />
                </div>
            )}
            {paused.length > 0 && (
                <div className="mx_ImportDetail_group">
                    <h4>{`${_t("tg_layout|import_paused")} · ${number(paused.length)}`}</h4>
                    <ChatList entries={paused} action={importAction} />
                </div>
            )}
            {skipped.length > 0 && (
                <details className="mx_ImportMore">
                    <summary>{`${_t("tg_layout|import_skipped")} · ${number(skipped.length)}`}</summary>
                    <ul className="mx_ImportList">
                        {skipped.map((entry) => (
                            <Row key={entry.room.roomId} entry={entry} actions={importAction(entry)} />
                        ))}
                    </ul>
                </details>
            )}
        </div>
    );
}
