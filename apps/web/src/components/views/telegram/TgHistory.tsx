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
import ChartIcon from "@vector-im/compound-design-tokens/assets/web/icons/chart";

import { _t } from "../../../languageHandler";
import { formatFullDateNoTime } from "../../../DateUtils";
import { useRoomState } from "../../../hooks/useRoomState";
import {
    type BackfillStatus,
    backfillStatusOf,
    fetchRoomStats,
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

function historyTitle(status: BackfillStatus): string {
    switch (status.state) {
        case "complete":
            return _t("tg_layout|history_complete");
        case "running":
            return _t("tg_layout|history_running");
        case "manual":
            return _t("tg_layout|history_manual");
        default:
            return _t("tg_layout|history_unavailable", { network: status.network || _t("tg_layout|history_network") });
    }
}

function formatEta(ms: number): string {
    const minutes = Math.max(1, Math.round(ms / 60_000));
    if (minutes < 60) return _t("tg_layout|history_eta_minutes", { count: minutes });
    const hours = Math.round(minutes / 6) / 10;
    if (hours < 48) return _t("tg_layout|history_eta_hours", { count: hours });
    return _t("tg_layout|history_eta_days", { count: Math.round(hours / 24) });
}

/** Pace, progress and time left, as far as they are known. */
function progressLine(progress: ImportProgress): string | undefined {
    const parts: string[] = [];
    if (progress.etaMs !== undefined) parts.push(_t("tg_layout|history_eta", { time: formatEta(progress.etaMs) }));
    if (progress.perMinute) {
        parts.push(_t("tg_layout|history_pace", { rate: number(Math.round(progress.perMinute)) }));
    }
    return parts.length ? parts.join(" · ") : undefined;
}

/** Follows a room's import while the bridge is running it. */
function useImportProgress(room: Room, status: BackfillStatus | undefined): ImportProgress {
    return useMemo(
        () => (status?.state === "running" ? trackImport(room.roomId, status) : {}),
        // A new record from the bridge is what moves the numbers.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [room.roomId, status?.state, status?.bridged_messages, status?.updated_ts],
    );
}

function historySubtitle(status: BackfillStatus): string {
    const parts = [_t("tg_layout|history_count", { count: status.bridged_messages, formatted: number(status.bridged_messages) })];
    if (status.remote_total !== undefined) {
        parts.push(_t("tg_layout|history_remote", { total: number(status.remote_total), network: status.network }));
    }
    if (status.oldest_ts) {
        parts.push(_t("tg_layout|history_back_to", { date: formatFullDateNoTime(new Date(status.oldest_ts)) }));
    }
    return parts.join(" · ");
}

/** Whether all of the chat is here, how far the import is while it runs, and a way to fetch the rest. */
export function TgHistoryRow({ room }: { room: Room }): JSX.Element | null {
    const status = useRoomState(room, () => backfillStatusOf(room));
    const progress = useImportProgress(room, status);
    const [asked, setAsked] = useState(false);
    if (!status) return null;

    // Only a chat that isn't being imported can be asked to be: while it runs, the button would be a lie.
    const canAsk = status.state === "manual" && !!status.command_prefix;
    const line = status.state === "running" ? progressLine(progress) : undefined;
    return (
        <>
            <TgRow
                icon={<HistoryIcon />}
                title={historyTitle(status)}
                subtitle={[historySubtitle(status), line].filter(Boolean).join(" · ")}
                className={`mx_TgHistory mx_TgHistory--${status.state}`}
            />
            {status.state === "running" && progress.fraction !== undefined && (
                <div className="mx_TgHistory_progress" role="progressbar" aria-valuenow={Math.round(progress.fraction * 100)}>
                    <Bar share={progress.fraction} />
                </div>
            )}
            {canAsk && (
                <TgRow
                    title={asked ? _t("tg_layout|history_requested") : _t("tg_layout|history_import")}
                    onClick={
                        asked
                            ? undefined
                            : (): void => {
                                  setAsked(true);
                                  void requestFullBackfill(room, status);
                              }
                    }
                />
            )}
        </>
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

/**
 * Shown where the timeline ends: if the bridge is still importing this chat's older history (or has
 * more it hasn't been asked for), this is not the start of the chat.
 */
export function BackfillNotice({ room }: { room: Room }): JSX.Element | null {
    const status = useRoomState(room, () => backfillStatusOf(room));
    const progress = useImportProgress(room, status);
    const [asked, setAsked] = useState(false);
    if (!status || (status.state !== "running" && status.state !== "manual")) return null;
    const line = status.state === "running" ? progressLine(progress) : undefined;
    return (
        <div className="mx_BackfillNotice" role="status">
            <span>{historyTitle(status)}. </span>
            {line && <span>{line}. </span>}
            {status.state === "manual" && status.command_prefix && !asked && (
                <button
                    type="button"
                    className="mx_BackfillNotice_button"
                    onClick={(): void => {
                        setAsked(true);
                        void requestFullBackfill(room, status);
                    }}
                >
                    {_t("tg_layout|history_import")}
                </button>
            )}
            {asked && <span>{_t("tg_layout|history_requested")}</span>}
        </div>
    );
}
