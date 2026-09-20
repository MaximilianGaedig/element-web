/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useContext, useEffect, useState } from "react";

import { _t } from "../../../../../languageHandler";
import MatrixClientContext from "../../../../../contexts/MatrixClientContext";
import SettingsTab from "../SettingsTab";
import { SettingsSection } from "../../shared/SettingsSection";
import { SettingsSubsection } from "../../shared/SettingsSubsection";
import { formatBytes } from "../../../../../utils/FormattingUtils";
import { fetchStorageOverview, type Storage, type StorageOverview, storedBytes } from "../../../../../utils/storage";
import dis from "../../../../../dispatcher/dispatcher";
import { ActivityCharts } from "../../../telegram/TgHistory";
import { Action } from "../../../../../dispatcher/actions";

/** A bar split in the shares it is made of, each with its name and size underneath. */
function Breakdown({ parts }: { parts: Array<{ label: string; bytes: number; tone: string }> }): JSX.Element {
    const total = parts.reduce((sum, part) => sum + part.bytes, 0);
    return (
        <div className="mx_StorageBreakdown">
            <div className="mx_StorageBreakdown_bar" role="img" aria-label={parts.map((p) => `${p.label} ${formatBytes(p.bytes)}`).join(", ")}>
                {parts.map((part) => (
                    <span
                        key={part.label}
                        className={`mx_StorageBreakdown_part mx_StorageBreakdown_part--${part.tone}`}
                        style={{ width: total ? `${Math.max(1, (part.bytes / total) * 100)}%` : 0 }}
                    />
                ))}
            </div>
            <ul className="mx_StorageBreakdown_legend">
                {parts.map((part) => (
                    <li key={part.label}>
                        <span className={`mx_StorageBreakdown_dot mx_StorageBreakdown_part--${part.tone}`} aria-hidden />
                        <span className="mx_StorageBreakdown_label">{part.label}</span>
                        <span className="mx_StorageBreakdown_value">{formatBytes(part.bytes)}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

function accountParts(storage: Storage): Array<{ label: string; bytes: number; tone: string }> {
    return [
        { label: _t("settings|storage|messages"), bytes: storage.events, tone: "messages" },
        { label: _t("settings|storage|media"), bytes: storage.media_stored, tone: "media" },
    ];
}

/**
 * What everything takes up: the account's total split into messages and media, the server's database and
 * media directory (for its admin), and the chats using the most space, largest first.
 */
export default function StorageUserSettingsTab(): JSX.Element {
    const client = useContext(MatrixClientContext);
    const [overview, setOverview] = useState<StorageOverview | undefined | null>(null);
    useEffect(() => {
        let cancelled = false;
        void fetchStorageOverview(client!).then((o) => {
            if (!cancelled) setOverview(o);
        });
        return (): void => {
            cancelled = true;
        };
    }, [client]);

    if (overview === null) {
        return (
            <SettingsTab data-testid="mx_StorageUserSettingsTab">
                <SettingsSection>
                    <p className="mx_StorageTab_status" role="status">
                        {_t("settings|storage|loading")}
                    </p>
                </SettingsSection>
            </SettingsTab>
        );
    }
    if (!overview) {
        return (
            <SettingsTab data-testid="mx_StorageUserSettingsTab">
                <SettingsSection>
                    <p className="mx_StorageTab_status">{_t("settings|storage|unsupported")}</p>
                </SettingsSection>
            </SettingsTab>
        );
    }

    const top = overview.rooms[0] ? storedBytes(overview.rooms[0].storage) : 1;
    return (
        <SettingsTab data-testid="mx_StorageUserSettingsTab">
            <SettingsSection>
                <SettingsSubsection heading={_t("settings|storage|account_heading")}>
                    <div className="mx_StorageTab_total">{formatBytes(storedBytes(overview.account))}</div>
                    <p className="mx_StorageTab_hint">
                        {_t("settings|storage|account_hint", { count: overview.room_count })}
                    </p>
                    <Breakdown parts={accountParts(overview.account)} />
                    {overview.account.media_on_demand > 0 && (
                        <p className="mx_StorageTab_hint">
                            {_t("settings|storage|on_demand", { size: formatBytes(overview.account.media_on_demand) })}
                        </p>
                    )}
                </SettingsSubsection>

                {overview.server && (
                    <SettingsSubsection heading={_t("settings|storage|server_heading")}>
                        <div className="mx_StorageTab_total">
                            {formatBytes(overview.server.database + overview.server.media)}
                        </div>
                        <Breakdown
                            parts={[
                                { label: _t("settings|storage|database"), bytes: overview.server.database, tone: "messages" },
                                { label: _t("settings|storage|media_files"), bytes: overview.server.media, tone: "media" },
                            ]}
                        />
                    </SettingsSubsection>
                )}

                {!!(overview.by_month?.length || overview.by_hour_of_week) && (
                    <SettingsSubsection heading={_t("settings|storage|activity_heading")}>
                        <ActivityCharts
                            months={overview.by_month ?? []}
                            week={overview.by_hour_of_week}
                            total={overview.by_month?.reduce((sum, m) => sum + m.count, 0) ?? 0}
                            open
                        />
                    </SettingsSubsection>
                )}

                <SettingsSubsection heading={_t("settings|storage|chats_heading")}>
                    <ol className="mx_StorageChats">
                        {overview.rooms.map((room) => {
                            const stored = storedBytes(room.storage);
                            return (
                                <li key={room.room_id}>
                                    <button
                                        type="button"
                                        className="mx_StorageChats_row"
                                        onClick={(): void =>
                                            dis.dispatch({ action: Action.ViewRoom, room_id: room.room_id, metricsTrigger: undefined })
                                        }
                                    >
                                        <span className="mx_StorageChats_name">{room.name ?? room.room_id}</span>
                                        <span className="mx_StorageChats_size">{formatBytes(stored)}</span>
                                        <span className="mx_StorageChats_bar" aria-hidden>
                                            <span style={{ width: `${Math.max(2, (stored / top) * 100)}%` }} />
                                        </span>
                                        <span className="mx_StorageChats_detail">
                                            {_t("settings|storage|chat_detail", {
                                                messages: room.messages.toLocaleString(),
                                                media: formatBytes(room.storage.media_stored),
                                            })}
                                            {room.storage.media_on_demand > 0 &&
                                                ` · ${_t("settings|storage|chat_on_demand", { size: formatBytes(room.storage.media_on_demand) })}`}
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ol>
                    {overview.room_count > overview.rooms.length && (
                        <p className="mx_StorageTab_hint">
                            {_t("settings|storage|more_chats", { count: overview.room_count - overview.rooms.length })}
                        </p>
                    )}
                </SettingsSubsection>
            </SettingsSection>
        </SettingsTab>
    );
}
