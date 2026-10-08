/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useSyncExternalStore } from "react";

import { PlaybackSpeed } from "../../../audio/PlaybackSpeed";
import { _t } from "../../../languageHandler";

/** The speed as written on the button: "1×", "1.5×", "2×". */
function formatSpeed(speed: number): string {
    return `${speed}×`;
}

/**
 * The button on a playing voice message that moves it on to the next speed, as in Telegram, WhatsApp and
 * Signal. The speed is shared by every voice message (see {@link PlaybackSpeed}).
 */
export function PlaybackSpeedButton({ className }: { className?: string }): JSX.Element {
    const speed = useSyncExternalStore(PlaybackSpeed.subscribe, () => PlaybackSpeed.current);
    const label = formatSpeed(speed);
    return (
        <button
            type="button"
            className={className}
            data-testid="playback-speed"
            title={_t("timeline|voice_message|speed", { speed: label })}
            aria-label={_t("timeline|voice_message|speed", { speed: label })}
            onClick={() => PlaybackSpeed.cycle()}
            // The seek bar and the bubble's own handlers must not see a press on the button.
            onMouseDown={(ev) => ev.stopPropagation()}
        >
            {label}
        </button>
    );
}
