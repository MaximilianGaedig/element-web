/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useEffect, useState } from "react";

import { ActivityDot, PRESENCE_TWEAKS_EVENT } from "../avatars/ActivityDot";
import { ACTIVITY_FADE_MS } from "../../../utils/presence/activity";

/**
 * A floating panel of sliders for tuning layout values on screen (the presence dot and "12m" tag so far).
 * Shown with `?tweaks` in the URL or `localStorage["mx_tg_tweaks"] = "1"`; the values are CSS variables
 * on <html>, kept in localStorage so they survive reloads. For trying values out - the chosen ones then
 * become the stylesheet defaults.
 */

interface Tweak {
    variable: string;
    label: string;
    min: number;
    max: number;
    step: number;
    initial: number;
}

const TWEAKS: Tweak[] = [
    { variable: "--tg-presence-dot-size", label: "Dot size", min: 6, max: 16, step: 0.5, initial: 10 },
    { variable: "--tg-presence-dot-right", label: "Dot right", min: -8, max: 8, step: 0.5, initial: 0 },
    { variable: "--tg-presence-dot-bottom", label: "Dot bottom", min: -8, max: 8, step: 0.5, initial: 0 },
    { variable: "--tg-presence-dot-gap", label: "Dot cut-out gap", min: 0, max: 5, step: 0.5, initial: 1 },
    { variable: "--tg-presence-tag-right", label: "Tag right", min: -10, max: 8, step: 0.5, initial: -8 },
    { variable: "--tg-presence-tag-bottom", label: "Tag bottom", min: -10, max: 8, step: 0.5, initial: -3 },
];

const STORAGE_KEY = "mx_tg_tweaks_values";

/** The ages the preview tag cycles through, in minutes. */
const PREVIEW_MINUTES = [
    ...Array.from({ length: 59 }, (_, i) => i + 1),
    ...Array.from({ length: 23 }, (_, i) => (i + 1) * 60),
];

function readStored(): Record<string, number> {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    } catch {
        return {};
    }
}

function isEnabled(): boolean {
    try {
        return (
            new URLSearchParams(window.location.search).has("tweaks") || localStorage.getItem("mx_tg_tweaks") === "1"
        );
    } catch {
        return false;
    }
}

export function TgTweaksPanel(): JSX.Element | null {
    const [values, setValues] = useState<Record<string, number>>(readStored);
    const [open, setOpen] = useState(true);
    const enabled = isEnabled();
    // The preview tag counts through every label it takes: 1m to 59m, then 1h to 23h.
    const [step, setStep] = useState(0);
    useEffect(() => {
        if (!enabled || !open) return;
        const timer = window.setInterval(() => setStep((i) => (i + 1) % PREVIEW_MINUTES.length), 400);
        return () => window.clearInterval(timer);
    }, [enabled, open]);
    const minutes = PREVIEW_MINUTES[step];

    // Stored values apply even without the panel, so a tuned look sticks.
    useEffect(() => {
        const root = document.documentElement;
        for (const t of TWEAKS) {
            if (values[t.variable] === undefined) root.style.removeProperty(t.variable);
            else root.style.setProperty(t.variable, `${values[t.variable]}px`);
        }
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
        } catch {
            // private mode
        }
        window.dispatchEvent(new Event(PRESENCE_TWEAKS_EVENT));
    }, [values]);

    if (!enabled) return null;
    return (
        <div className="mx_TgTweaksPanel">
            <button type="button" className="mx_TgTweaksPanel_toggle" onClick={() => setOpen(!open)}>
                {open ? "Tweaks ▾" : "Tweaks ▸"}
            </button>
            {open && (
                <>
                    {/* Live preview: the dots it tunes are in the room list, which may be off screen. */}
                    <div className="mx_TgTweaksPanel_preview">
                        {(["online", "recent"] as const).map((kind) => (
                            <div key={kind} className="mx_RoomAvatarView">
                                <div
                                    className={`mx_RoomAvatarView_RoomAvatar mx_TgTweaksPanel_avatar mx_RoomAvatarView_RoomAvatar_${kind === "online" ? "presence" : "recent"}`}
                                />
                                <ActivityDot
                                    level={kind === "online" ? 1 : 1 - (minutes * 60000) / ACTIVITY_FADE_MS}
                                    className="mx_RoomAvatarView_PresenceDecoration"
                                />
                            </div>
                        ))}
                    </div>
                    {TWEAKS.map((t) => {
                        const value = values[t.variable] ?? t.initial;
                        return (
                            <label key={t.variable} className="mx_TgTweaksPanel_row">
                                <span>
                                    {t.label}: {value}px
                                </span>
                                <input
                                    type="range"
                                    min={t.min}
                                    max={t.max}
                                    step={t.step}
                                    value={value}
                                    onChange={(e) => setValues({ ...values, [t.variable]: Number(e.target.value) })}
                                />
                            </label>
                        );
                    })}
                    <button type="button" onClick={() => setValues({})}>
                        Reset
                    </button>
                    <code className="mx_TgTweaksPanel_values">
                        {TWEAKS.map((t) => `${t.variable}: ${values[t.variable] ?? t.initial}px;`).join("\n")}
                    </code>
                </>
            )}
        </div>
    );
}
