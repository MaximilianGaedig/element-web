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
import { fetchStorageOverview, type StorageOverview } from "../../../../../utils/storage";
import { ActivityCharts } from "../../../telegram/TgHistory";

/** When your messages were sent, across all chats: by year, month, weekday and hour of the day. */
export default function ActivityUserSettingsTab(): JSX.Element {
    const client = useContext(MatrixClientContext);
    const [overview, setOverview] = useState<StorageOverview | undefined | null>(null);
    useEffect(() => {
        let cancelled = false;
        void fetchStorageOverview(client).then((o) => {
            if (!cancelled) setOverview(o);
        });
        return (): void => {
            cancelled = true;
        };
    }, [client]);

    const months = overview?.by_month ?? [];
    const hasData = !!(months.length || overview?.by_hour_of_week);
    return (
        <SettingsTab data-testid="mx_ActivityUserSettingsTab">
            <SettingsSection>
                {overview === null ? (
                    <p className="mx_StorageTab_status" role="status">
                        {_t("settings|storage|loading")}
                    </p>
                ) : hasData ? (
                    <ActivityCharts
                        months={months}
                        week={overview?.by_hour_of_week}
                        total={months.reduce((sum, m) => sum + m.count, 0)}
                        open
                    />
                ) : (
                    <p className="mx_StorageTab_status">
                        {overview ? _t("tg_layout|activity_none") : _t("settings|storage|unsupported")}
                    </p>
                )}
            </SettingsSection>
        </SettingsTab>
    );
}
