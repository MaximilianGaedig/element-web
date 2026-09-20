/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * A chat's details: how much of its history has been imported from the other network, and how many
 * messages it has, in total, by kind, and per person.
 */

import React, { type JSX, useContext, useEffect, useMemo, useState } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";
import HistoryIcon from "@vector-im/compound-design-tokens/assets/web/icons/history";
import CheckIcon from "@vector-im/compound-design-tokens/assets/web/icons/check";
import ChevronIcon from "@vector-im/compound-design-tokens/assets/web/icons/chevron-down";
import PauseIcon from "@vector-im/compound-design-tokens/assets/web/icons/pause";
import StorageIcon from "@vector-im/compound-design-tokens/assets/web/icons/download";
import ChartIcon from "@vector-im/compound-design-tokens/assets/web/icons/chart";

import { _t } from "../../../languageHandler";
import { formatFullDateNoTime } from "../../../DateUtils";
import { SDKContext } from "../../../contexts/SDKContext";
import MatrixClientContext from "../../../contexts/MatrixClientContext";
import { collectImports, estimateQueued, type QueuedEstimate } from "../../../utils/importOverview";
import { RightPanelPhases } from "../../../stores/right-panel/RightPanelStorePhases";
import { useRoomState } from "../../../hooks/useRoomState";
import {
    type BackfillStatus,
    backfillStatusOf,
    fetchRoomStats,
    hourOfWeekLocal,
    perYear,
    weekdayAndHour,
    type HistoryPhase,
    historyPhase,
    type ImportProgress,
    requestFullBackfill,
    requestSkipBackfill,
    type RoomStats,
    trackImport,
} from "../../../utils/chatHistory";
import { formatBytes } from "../../../utils/FormattingUtils";
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
function useHistory(room: Room): {
    status?: BackfillStatus;
    phase?: HistoryPhase;
    progress: ImportProgress;
    queued: QueuedEstimate;
} {
    const client = useContext(MatrixClientContext);
    const status = useRoomState(room, () => backfillStatusOf(room));
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (status?.state !== "running") return;
        const timer = window.setInterval(() => setNow(Date.now()), 30_000);
        return (): void => window.clearInterval(timer);
    }, [status?.state]);
    const phase = status ? historyPhase(status, now) : undefined;
    const progress = useMemo(
        // Exact progress is worth showing for a waiting chat too: how many of how many, and what is left.
        () => (status && (phase === "importing" || phase === "queued") ? trackImport(room.roomId, status) : {}),
        // A new record from the bridge is what moves the numbers.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [room.roomId, phase, status?.bridged_messages, status?.updated_ts, status?.rate_per_min],
    );
    const queued = useMemo(
        () => (client && phase === "queued" ? estimateQueued(collectImports(client, now), room.roomId) : {}),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [client, room.roomId, phase, status?.updated_ts, now],
    );
    return { status, phase, progress, queued };
}

const PHASE_KEYS: Record<HistoryPhase, { title: string; badge: string }> = {
    importing: { title: "tg_layout|history_importing", badge: "tg_layout|history_badge_importing" },
    queued: { title: "tg_layout|history_queued", badge: "tg_layout|history_badge_queued" },
    paused: { title: "tg_layout|history_paused", badge: "tg_layout|history_badge_paused" },
    skipped: { title: "tg_layout|history_skipped", badge: "tg_layout|history_badge_skipped" },
    complete: { title: "tg_layout|history_complete", badge: "tg_layout|history_badge_complete" },
    unavailable: { title: "tg_layout|history_unavailable_title", badge: "tg_layout|history_badge_unavailable" },
};

/** A ring that turns while the import runs, a check when it's done: one glance says which. */
function PhaseIcon({ phase }: { phase: HistoryPhase }): JSX.Element {
    if (phase === "importing") return <span className="mx_HistoryPhaseIcon mx_HistoryPhaseIcon--spin" aria-hidden />;
    if (phase === "complete") return <CheckIcon className="mx_HistoryPhaseIcon" aria-hidden />;
    if (phase === "paused" || phase === "skipped") return <PauseIcon className="mx_HistoryPhaseIcon" aria-hidden />;
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
/**
 * Once a chat's history is settled (all imported, skipped, or nothing to import) it takes one line, a
 * verification: a check and the number. Tapping it opens the few details that back the claim up.
 */
function CompactHistory({ room, status, phase }: { room: Room; status: BackfillStatus; phase: HistoryPhase }): JSX.Element {
    const [asked, setAsked] = useState(false);
    const network = status.network || _t("tg_layout|history_network");
    const summary =
        phase === "complete"
            ? _t("tg_layout|history_done_count", {
                  count: status.bridged_messages,
                  formatted: number(status.bridged_messages),
              })
            : phase === "skipped"
              ? _t("tg_layout|history_skipped")
              : _t("tg_layout|history_unavailable_title");
    const canAsk = phase === "skipped" && !!status.command_prefix;
    return (
        <section className={`mx_HistoryCompact mx_HistoryCompact--${phase}`} data-testid="tg-history-compact">
            <details>
                <summary className="mx_HistoryCompact_summary">
                    <PhaseIcon phase={phase} />
                    <span className="mx_HistoryCompact_text">{summary}</span>
                    <ChevronIcon className="mx_HistoryCompact_chevron" aria-hidden />
                </summary>
                <dl className="mx_HistoryCard_stats mx_HistoryCompact_details">
                    {status.oldest_ts ? (
                        <Stat label={_t("tg_layout|history_stat_oldest")} value={formatFullDateNoTime(new Date(status.oldest_ts))} />
                    ) : null}
                    {status.remote_total !== undefined && (
                        <Stat
                            label={_t("tg_layout|history_stat_on_network", { network })}
                            value={number(status.remote_total)}
                        />
                    )}
                    {phase === "unavailable" && (
                        <Stat label={network} value={_t("tg_layout|history_unavailable_hint", { network })} />
                    )}
                </dl>
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
            </details>
        </section>
    );
}

export function TgHistoryCard({ room }: { room: Room }): JSX.Element | null {
    const { status, phase, progress, queued } = useHistory(room);
    const [asked, setAsked] = useState(false);
    if (!status || !phase) return null;
    if (phase === "complete" || phase === "skipped" || phase === "unavailable") {
        return <CompactHistory room={room} status={status} phase={phase} />;
    }

    const percent = progress.fraction !== undefined ? Math.min(99, Math.floor(progress.fraction * 100)) : undefined;
    const showBar = phase === "importing" || phase === "queued";
    const network = status.network || _t("tg_layout|history_network");

    let subtitle: string | undefined;
    if (phase === "importing") {
        subtitle =
            progress.etaMs !== undefined
                ? _t("tg_layout|history_eta", { time: formatEta(progress.etaMs) })
                : _t("tg_layout|history_working", { network });
    } else if (phase === "queued") {
        subtitle =
            status.queue_ahead !== undefined && status.queue_size
                ? _t("tg_layout|history_queue_position", {
                      position: status.queue_ahead + 1,
                      size: status.queue_size,
                  })
                : _t("tg_layout|history_queued_hint");
    } else {
        subtitle = _t("tg_layout|history_paused_hint");
    }

    const etaMs = phase === "queued" ? queued.etaMs : progress.etaMs;
    const stats: Array<[string, string]> = [
        [
            _t("tg_layout|history_stat_imported"),
            status.remote_total
                ? _t("tg_layout|history_x_of_y", { done: number(status.bridged_messages), total: number(status.remote_total) })
                : number(status.bridged_messages),
        ],
    ];
    if (phase === "queued" && queued.waitMs !== undefined) {
        stats.push([_t("tg_layout|history_stat_starts"), _t("tg_layout|history_in_time", { time: formatEta(queued.waitMs) })]);
    }
    if (etaMs !== undefined) stats.push([_t("tg_layout|history_stat_eta"), formatEta(etaMs)]);
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
    if (status.oldest_ts) {
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

            {(phase === "importing" || phase === "queued") && status.command_prefix && (
                <button
                    type="button"
                    className="mx_HistoryCard_secondary"
                    disabled={asked}
                    onClick={(): void => {
                        setAsked(true);
                        void requestSkipBackfill(room, status);
                    }}
                >
                    {_t("tg_layout|history_skip")}
                </button>
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
 * A banner under the header (and under the pinned messages, when there are some) while the chat's older
 * history is still coming: what is happening, how far along, how long it should take, in a line or two and
 * a thin progress bar. Tapping it opens the chat's details. Nothing once the history is settled.
 */
export function ImportBanner({ room }: { room: Room }): JSX.Element | null {
    const sdkContext = useContext(SDKContext);
    const { status, phase, progress, queued } = useHistory(room);
    const [asked, setAsked] = useState(false);
    if (!status || !phase || phase === "complete" || phase === "unavailable" || phase === "skipped") return null;

    const percent = progress.fraction !== undefined ? Math.min(99, Math.floor(progress.fraction * 100)) : undefined;
    const network = status.network || _t("tg_layout|history_network");
    let title: string;
    let detail: string | undefined;
    if (phase === "importing") {
        title = _t("tg_layout|history_importing");
        detail =
            [
                percent === undefined ? undefined : `${percent}%`,
                progress.left !== undefined && progress.left > 0
                    ? _t("tg_layout|banner_left", { formatted: number(progress.left) })
                    : undefined,
                progress.etaMs !== undefined ? _t("tg_layout|history_eta", { time: formatEta(progress.etaMs) }) : undefined,
                progress.perMinute ? _t("tg_layout|history_pace", { rate: number(Math.round(progress.perMinute)) }) : undefined,
            ]
                .filter(Boolean)
                .join(" · ") || _t("tg_layout|history_working", { network });
    } else if (phase === "queued") {
        title = _t("tg_layout|history_queued");
        detail =
            [
                status.remote_total
                    ? _t("tg_layout|history_x_of_y", {
                          done: number(status.bridged_messages),
                          total: number(status.remote_total),
                      })
                    : undefined,
                status.queue_ahead !== undefined && status.queue_size
                    ? _t("tg_layout|history_queue_position", { position: status.queue_ahead + 1, size: status.queue_size })
                    : undefined,
                queued.waitMs !== undefined
                    ? _t("tg_layout|history_stat_starts") + " " + _t("tg_layout|history_in_time", { time: formatEta(queued.waitMs) })
                    : undefined,
            ]
                .filter(Boolean)
                .join(" · ") || _t("tg_layout|history_queued_hint");
    } else {
        title = _t("tg_layout|history_paused");
        detail = _t("tg_layout|history_paused_hint");
    }

    const open = (): void => sdkContext.rightPanelStore.setCard({ phase: RightPanelPhases.RoomSummary }, false, room.roomId);
    return (
        <div className={`mx_TgImport mx_TgImport--${phase}`} role="status" data-testid="import-banner">
            <button type="button" className="mx_TgImport_main" onClick={open}>
                {phase === "importing" ? (
                    <span className="mx_HistoryPhaseIcon mx_HistoryPhaseIcon--spin" aria-hidden />
                ) : (
                    <PhaseIcon phase={phase} />
                )}
                <span className="mx_TgImport_text">
                    <span className="mx_TgImport_title">{title}</span>
                    <span className="mx_TgImport_detail">{detail}</span>
                </span>
            </button>
            {phase === "paused" && status.command_prefix && (
                <button
                    type="button"
                    className="mx_TgImport_action"
                    disabled={asked}
                    onClick={(): void => {
                        setAsked(true);
                        void requestFullBackfill(room, status);
                    }}
                >
                    {asked ? _t("tg_layout|history_requested") : _t("tg_layout|history_pill_import")}
                </button>
            )}
            {(phase === "importing" || phase === "queued") && (
                <span
                    className={`mx_TgImport_bar${percent === undefined && phase === "importing" ? " mx_TgImport_bar--indeterminate" : ""}`}
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                    aria-label={title}
                >
                    <span style={percent === undefined ? undefined : { width: `${Math.max(2, percent)}%` }} />
                </span>
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

function BarChart({
    values,
    labels,
    height = 56,
    label,
}: {
    values: number[];
    labels: string[];
    height?: number;
    label: string;
}): JSX.Element {
    const max = Math.max(1, ...values);
    return (
        <div className="mx_ActivityChart" role="img" aria-label={label} style={{ height }}>
            {values.map((value, i) => (
                <span
                    key={i}
                    className="mx_ActivityChart_bar"
                    style={{ height: `${Math.max(value ? 3 : 0, (value / max) * 100)}%` }}
                    title={`${labels[i]}: ${number(value)}`}
                />
            ))}
        </div>
    );
}

/** When the messages were sent: per year and month, per weekday, per hour of the day. */
export function ActivityCharts({
    months,
    week,
    total,
    open,
}: {
    months: Array<{ month: string; count: number }>;
    week?: number[];
    total: number;
    open?: boolean;
}): JSX.Element | null {
    if (!months.length && !week) return null;

    const years = perYear(months);
    const weekdayNames = Array.from({ length: 7 }, (_, i) =>
        new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(2024, 0, 1 + i)),
    );
    const { weekdays, hoursOfDay } = weekdayAndHour(week ? hourOfWeekLocal(week) : new Array(168).fill(0));
    const busiestDay = weekdays.indexOf(Math.max(...weekdays));
    const busiestHour = hoursOfDay.indexOf(Math.max(...hoursOfDay));
    return (
        <details className="mx_ActivitySection" open={open}>
            <summary>
                <span className="mx_ActivitySection_title">{_t("tg_layout|activity_title")}</span>
                {week && total > 0 && (
                    <span className="mx_ActivitySection_hint">
                        {_t("tg_layout|activity_busiest", {
                            day: weekdayNames[busiestDay],
                            hour: `${String(busiestHour).padStart(2, "0")}:00`,
                        })}
                    </span>
                )}
            </summary>
            {years.length > 1 && (
                <div className="mx_ActivitySection_block">
                    <div className="mx_ActivitySection_label">{_t("tg_layout|activity_years")}</div>
                    <BarChart values={years.map((y) => y.count)} labels={years.map((y) => y.year)} label={_t("tg_layout|activity_years")} />
                    <div className="mx_ActivityChart_axis">
                        <span>{years[0].year}</span>
                        <span>{years[years.length - 1].year}</span>
                    </div>
                </div>
            )}
            {months.length > 1 && (
                <div className="mx_ActivitySection_block">
                    <div className="mx_ActivitySection_label">{_t("tg_layout|activity_months")}</div>
                    <BarChart
                        values={months.slice(-60).map((m) => m.count)}
                        labels={months.slice(-60).map((m) => m.month)}
                        label={_t("tg_layout|activity_months")}
                    />
                    <div className="mx_ActivityChart_axis">
                        <span>{months.slice(-60)[0].month}</span>
                        <span>{months[months.length - 1].month}</span>
                    </div>
                </div>
            )}
            {week && (
                <>
                    <div className="mx_ActivitySection_block">
                        <div className="mx_ActivitySection_label">{_t("tg_layout|activity_weekdays")}</div>
                        <BarChart values={weekdays} labels={weekdayNames} label={_t("tg_layout|activity_weekdays")} />
                        <div className="mx_ActivityChart_axis mx_ActivityChart_axis--spread">
                            {weekdayNames.map((n) => (
                                <span key={n}>{n.slice(0, 2)}</span>
                            ))}
                        </div>
                    </div>
                    <div className="mx_ActivitySection_block">
                        <div className="mx_ActivitySection_label">{_t("tg_layout|activity_hours")}</div>
                        <BarChart
                            values={hoursOfDay}
                            labels={hoursOfDay.map((_, h) => `${String(h).padStart(2, "0")}:00`)}
                            label={_t("tg_layout|activity_hours")}
                        />
                        <div className="mx_ActivityChart_axis">
                            <span>00</span>
                            <span>12</span>
                            <span>23</span>
                        </div>
                    </div>
                </>
            )}
        </details>
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
            <ActivityCharts months={stats.by_month ?? []} week={stats.by_hour_of_week} total={stats.total} />
            {stats.storage && (
                <TgRow
                    icon={<StorageIcon />}
                    title={_t("tg_layout|storage_title", {
                        size: formatBytes(stats.storage.events + stats.storage.media_stored),
                    })}
                    subtitle={[
                        _t("tg_layout|storage_messages", { size: formatBytes(stats.storage.events) }),
                        _t("tg_layout|storage_media", { size: formatBytes(stats.storage.media_stored) }),
                        stats.storage.media_on_demand > 0
                            ? _t("tg_layout|storage_on_demand", { size: formatBytes(stats.storage.media_on_demand) })
                            : undefined,
                    ]
                        .filter(Boolean)
                        .join(" · ")}
                />
            )}
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

