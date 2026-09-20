/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * A chat's details: how much of its history has been imported from the other network, and how many
 * messages it has, in total, by kind, and per person.
 */

import React, { type JSX, useEffect, useMemo, useState } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";
import HistoryIcon from "@vector-im/compound-design-tokens/assets/web/icons/history";
import CheckIcon from "@vector-im/compound-design-tokens/assets/web/icons/check";
import PauseIcon from "@vector-im/compound-design-tokens/assets/web/icons/pause";
import ChartIcon from "@vector-im/compound-design-tokens/assets/web/icons/chart";

import { _t } from "../../../languageHandler";
import { formatFullDateNoTime } from "../../../DateUtils";
import { useRoomState } from "../../../hooks/useRoomState";
import {
    type BackfillStatus,
    backfillStatusOf,
    fetchRoomStats,
    type HistoryPhase,
    historyPhase,
    type ImportProgress,
    requestFullBackfill,
    type RoomStats,
    trackImport,
} from "../../../utils/chatHistory";
import { TgRow } from "./TgProfile";

const number = (n: number): string => n.toLocaleString();

const KIND_ORDER = ["text", "image", "video", "voice", "audio", "file", "sticker", "encrypted"] as const;

function kindLabel(kind: string): string {
    switch (kind) {
        case "text":
            return _t("tg_layout|stats_kind_text");
        case "image":
            return _t("tg_layout|stats_kind_image");
        case "video":
            return _t("tg_layout|stats_kind_video");
        case "voice":
            return _t("tg_layout|stats_kind_voice");
        case "audio":
            return _t("tg_layout|stats_kind_audio");
        case "file":
            return _t("tg_layout|stats_kind_file");
        case "sticker":
            return _t("tg_layout|stats_kind_sticker");
        case "encrypted":
            return _t("tg_layout|stats_kind_encrypted");
        default:
            return kind;
    }
}

function formatEta(ms: number): string {
    const minutes = Math.max(1, Math.round(ms / 60_000));
    if (minutes < 60) return _t("tg_layout|history_eta_minutes", { count: minutes });
    const hours = Math.round(minutes / 6) / 10;
    if (hours < 48) return _t("tg_layout|history_eta_hours", { count: hours });
    return _t("tg_layout|history_eta_days", { count: Math.round(hours / 24) });
}

/** Whether the chat's history is being imported this minute (the header says so instead of "last seen"). */
export function useImportActive(room: Room): boolean {
    return useHistory(room).phase === "importing";
}

/** The chat's history state, kept fresh: a running import that goes quiet becomes "queued" on its own. */
function useHistory(room: Room): { status?: BackfillStatus; phase?: HistoryPhase; progress: ImportProgress } {
    const status = useRoomState(room, () => backfillStatusOf(room));
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (status?.state !== "running") return;
        const timer = window.setInterval(() => setNow(Date.now()), 30_000);
        return (): void => window.clearInterval(timer);
    }, [status?.state]);
    const phase = status ? historyPhase(status, now) : undefined;
    const progress = useMemo(
        () => (status && phase === "importing" ? trackImport(room.roomId, status) : {}),
        // A new record from the bridge is what moves the numbers.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [room.roomId, phase, status?.bridged_messages, status?.updated_ts, status?.rate_per_min],
    );
    return { status, phase, progress };
}

const PHASE_KEYS: Record<HistoryPhase, { title: string; badge: string }> = {
    importing: { title: "tg_layout|history_importing", badge: "tg_layout|history_badge_importing" },
    queued: { title: "tg_layout|history_queued", badge: "tg_layout|history_badge_queued" },
    paused: { title: "tg_layout|history_paused", badge: "tg_layout|history_badge_paused" },
    complete: { title: "tg_layout|history_complete", badge: "tg_layout|history_badge_complete" },
    unavailable: { title: "tg_layout|history_unavailable_title", badge: "tg_layout|history_badge_unavailable" },
};

/** A ring that turns while the import runs, a check when it's done: one glance says which. */
function PhaseIcon({ phase }: { phase: HistoryPhase }): JSX.Element {
    if (phase === "importing") return <span className="mx_HistoryPhaseIcon mx_HistoryPhaseIcon--spin" aria-hidden />;
    if (phase === "complete") return <CheckIcon className="mx_HistoryPhaseIcon" aria-hidden />;
    if (phase === "paused") return <PauseIcon className="mx_HistoryPhaseIcon" aria-hidden />;
    return <HistoryIcon className="mx_HistoryPhaseIcon" aria-hidden />;
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
    return (
        <div className="mx_HistoryCard_stat">
            <dt>{label}</dt>
            <dd>{value}</dd>
        </div>
    );
}

/**
 * How much of the chat's history is here: what state it is in (a badge and an icon that moves while it
 * imports), a bar with the percentage, the numbers, and, only when it is stopped, the one button that
 * carries on. Grouped-card layout as in Telegram iOS's settings; the same on a phone, where the
 * button is a full-width 48px target.
 */
export function TgHistoryCard({ room }: { room: Room }): JSX.Element | null {
    const { status, phase, progress } = useHistory(room);
    const [asked, setAsked] = useState(false);
    if (!status || !phase) return null;

    const percent =
        phase === "complete" ? 100 : progress.fraction !== undefined ? Math.min(99, Math.floor(progress.fraction * 100)) : undefined;
    const showBar = phase === "importing" || phase === "queued" || phase === "complete";
    const network = status.network || _t("tg_layout|history_network");

    let subtitle: string | undefined;
    if (phase === "importing") {
        subtitle =
            progress.etaMs !== undefined
                ? _t("tg_layout|history_eta", { time: formatEta(progress.etaMs) })
                : _t("tg_layout|history_working", { network });
    } else if (phase === "queued") {
        subtitle = _t("tg_layout|history_queued_hint");
    } else if (phase === "paused") {
        subtitle = _t("tg_layout|history_paused_hint");
    } else if (phase === "complete" && status.oldest_ts) {
        subtitle = _t("tg_layout|history_back_to", { date: formatFullDateNoTime(new Date(status.oldest_ts)) });
    } else if (phase === "unavailable") {
        subtitle = _t("tg_layout|history_unavailable_hint", { network });
    }

    const stats: Array<[string, string]> = [];
    if (phase !== "unavailable") {
        stats.push([_t("tg_layout|history_stat_imported"), number(status.bridged_messages)]);
    }
    if (phase === "importing" || phase === "queued") {
        if (progress.left !== undefined) {
            stats.push([_t("tg_layout|history_stat_left"), `~${number(progress.left)}`]);
        }
        if (progress.perMinute) {
            stats.push([
                _t("tg_layout|history_stat_speed"),
                _t("tg_layout|history_pace", { rate: number(Math.round(progress.perMinute)) }),
            ]);
        }
    }
    if (phase !== "complete" && phase !== "unavailable" && status.oldest_ts) {
        stats.push([_t("tg_layout|history_stat_oldest"), formatFullDateNoTime(new Date(status.oldest_ts))]);
    }

    const canAsk = phase === "paused" && !!status.command_prefix;
    return (
        <section className={`mx_HistoryCard mx_HistoryCard--${phase}`} data-testid="tg-history-card">
            <header className="mx_HistoryCard_header">
                <PhaseIcon phase={phase} />
                <div className="mx_HistoryCard_text">
                    <h3 className="mx_HistoryCard_title">{_t(PHASE_KEYS[phase].title as never)}</h3>
                    {subtitle && <p className="mx_HistoryCard_subtitle">{subtitle}</p>}
                </div>
                <span className="mx_HistoryCard_badge" role="status">
                    {_t(PHASE_KEYS[phase].badge as never)}
                </span>
            </header>

            {showBar && (
                <div className="mx_HistoryCard_progress">
                    <div
                        className={`mx_HistoryBar${percent === undefined && phase === "importing" ? " mx_HistoryBar--indeterminate" : ""}`}
                        role="progressbar"
                        aria-label={_t(PHASE_KEYS[phase].title as never)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={percent}
                        aria-valuetext={percent === undefined ? undefined : `${percent}%`}
                    >
                        <span className="mx_HistoryBar_fill" style={percent === undefined ? undefined : { width: `${Math.max(2, percent)}%` }} />
                    </div>
                    {percent !== undefined && <span className="mx_HistoryCard_percent">{percent}%</span>}
                </div>
            )}

            {stats.length > 0 && (
                <dl className="mx_HistoryCard_stats">
                    {stats.map(([label, value]) => (
                        <Stat key={label} label={label} value={value} />
                    ))}
                </dl>
            )}

            {canAsk && (
                <button
                    type="button"
                    className="mx_HistoryCard_action"
                    disabled={asked}
                    onClick={(): void => {
                        setAsked(true);
                        void requestFullBackfill(room, status);
                    }}
                >
                    {asked ? _t("tg_layout|history_requested") : _t("tg_layout|history_import")}
                </button>
            )}
        </section>
    );
}

/**
 * Under the chat's name while its history is being imported, where Telegram puts "updating…": the same
 * small line, with animated dots, and the percentage when it is known.
 */
export function ImportSubtitle({ room }: { room: Room }): JSX.Element | null {
    const { status, phase, progress } = useHistory(room);
    if (!status || phase !== "importing") return null;
    const percent = progress.fraction !== undefined ? Math.min(99, Math.floor(progress.fraction * 100)) : undefined;
    return (
        <div className="mx_ImportSubtitle" role="status" data-testid="import-subtitle">
            <span>{percent === undefined ? _t("tg_layout|history_subtitle") : _t("tg_layout|history_subtitle_percent", { percent })}</span>
            <span className="mx_ImportSubtitle_dots" aria-hidden>
                <i />
                <i />
                <i />
            </span>
        </div>
    );
}

/**
 * At the top of the conversation, where the older messages will appear: a small pill (like the date
 * pills) saying they are still coming, and tapping it opens the details. Nothing here for a chat whose
 * history is complete.
 */
export function BackfillNotice({ room }: { room: Room }): JSX.Element | null {
    const { status, phase, progress } = useHistory(room);
    const [asked, setAsked] = useState(false);
    if (!status || !phase || phase === "complete" || phase === "unavailable") return null;
    const percent = progress.fraction !== undefined ? Math.min(99, Math.floor(progress.fraction * 100)) : undefined;
    return (
        <div className={`mx_BackfillNotice mx_BackfillNotice--${phase}`} role="status">
            {phase === "importing" && <span className="mx_HistoryPhaseIcon mx_HistoryPhaseIcon--spin mx_BackfillNotice_spinner" aria-hidden />}
            <span className="mx_BackfillNotice_text">
                {phase === "importing"
                    ? percent === undefined
                        ? _t("tg_layout|history_pill_importing")
                        : _t("tg_layout|history_pill_importing_percent", { percent })
                    : phase === "queued"
                      ? _t("tg_layout|history_pill_queued")
                      : _t("tg_layout|history_pill_paused")}
            </span>
            {phase === "paused" && status.command_prefix && (
                <button
                    type="button"
                    className="mx_BackfillNotice_button"
                    disabled={asked}
                    onClick={(): void => {
                        setAsked(true);
                        void requestFullBackfill(room, status);
                    }}
                >
                    {asked ? _t("tg_layout|history_requested") : _t("tg_layout|history_pill_import")}
                </button>
            )}
        </div>
    );
}

function Bar({ share }: { share: number }): JSX.Element {
    return (
        <span className="mx_TgStats_bar" aria-hidden>
            <span className="mx_TgStats_barFill" style={{ width: `${Math.max(2, Math.round(share * 100))}%` }} />
        </span>
    );
}

/** The room's message counts: the total, its kinds, and who wrote how much. */
export function TgStatsSection({ room }: { room: Room }): JSX.Element | null {
    const [stats, setStats] = useState<RoomStats | undefined>();
    useEffect(() => {
        let cancelled = false;
        void fetchRoomStats(room.client, room.roomId).then((s) => {
            if (!cancelled) setStats(s);
        });
        return (): void => {
            cancelled = true;
        };
    }, [room]);

    if (!stats || stats.total === 0) return null;
    const top = stats.senders[0]?.total ?? 1;
    const kinds = KIND_ORDER.filter((k) => stats.by_kind[k]);
    return (
        <section className="mx_TgProfile_section mx_TgStats" data-testid="tg-stats">
            <TgRow
                icon={<ChartIcon />}
                title={_t("tg_layout|stats_total", { count: stats.total, formatted: number(stats.total) })}
                subtitle={
                    stats.complete
                        ? kinds.map((k) => `${number(stats.by_kind[k])} ${kindLabel(k)}`).join(" · ")
                        : _t("tg_layout|stats_counting")
                }
            />
            {stats.senders.map((sender) => {
                const member = room.getMember(sender.user_id);
                return (
                    <TgRow
                        key={sender.user_id}
                        className="mx_TgStats_sender"
                        title={member?.name ?? sender.user_id}
                        subtitle={<Bar share={sender.total / top} />}
                        right={<span className="mx_TgStats_count">{number(sender.total)}</span>}
                    />
                );
            })}
            {stats.sender_count > stats.senders.length && (
                <TgRow
                    className="mx_TgStats_more"
                    title={_t("tg_layout|stats_more_senders", { count: stats.sender_count - stats.senders.length })}
                />
            )}
        </section>
    );
}

