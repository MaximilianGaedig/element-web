/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * What the layout thinks the screen is, on the screen itself.
 *
 * The layout bugs that only appear in a home-screen app - the app not filling the screen, a bar sitting
 * against the clock, the composer under the keyboard - all come down to a handful of numbers that cannot
 * be read there: a phone has no console, and the values differ from any desktop browser's. This shows
 * them, live, so a report can carry the numbers instead of a description.
 *
 * Shown with `?metrics` in the URL or `localStorage["mx_tg_metrics"] = "1"`, like the tweaks panel.
 */

import React, { type JSX, useEffect, useState } from "react";

interface Metric {
    name: string;
    value: string;
}

const px = (n: number): string => `${Math.round(n)}px`;

function readCustomProperty(name: string): string {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || "(unset)";
}

/** 100dvh as the browser resolves it, which is the number the whole layout hangs off. */
function measureDvh(win: Window): number {
    const probe = win.document.createElement("div");
    probe.style.cssText = "position:fixed;top:0;left:0;width:0;height:100dvh;visibility:hidden;pointer-events:none";
    win.document.body.appendChild(probe);
    const height = probe.getBoundingClientRect().height;
    probe.remove();
    return height;
}

/** Everything the layout is deciding from, in the order it matters when something looks wrong. */
export function readMetrics(win: Window = window): Metric[] {
    const root = win.document.documentElement;
    const visual = win.visualViewport;
    const appHeight = readCustomProperty("--tg-app-height");
    return [
        { name: "screen tier", value: root.getAttribute("data-tg-screen") ?? "(unset)" },
        { name: "layout", value: win.document.querySelector("[data-telegram-layout]") ? "telegram" : "(none)" },
        { name: "standalone", value: String(win.matchMedia("(display-mode: standalone)").matches) },
        { name: "innerHeight", value: px(win.innerHeight) },
        { name: "100dvh", value: px(measureDvh(win)) },
        { name: "visualViewport", value: visual ? `${px(visual.height)} @ ${px(visual.offsetTop)}` : "(none)" },
        { name: "--tg-app-height", value: appHeight },
        { name: "--tg-vh × 100", value: px(Number.parseFloat(readCustomProperty("--tg-vh")) * 100 || 0) },
        {
            name: "safe top / bottom",
            value: `${readCustomProperty("--tg-safe-top")} / ${readCustomProperty("--tg-safe-bottom")}`,
        },
        {
            name: "header / composer block",
            value: `${readCustomProperty("--tg-header-block")} / ${readCustomProperty("--tg-composer-block")}`,
        },
        { name: "keyboard", value: String(root.hasAttribute("data-tg-keyboard")) },
        { name: "app element", value: describeApp(win) },
    ];
}

/** The columns' own box, which is what actually fills (or fails to fill) the screen. */
function describeApp(win: Window): string {
    const app = win.document.querySelector(".mx_TgColumns");
    if (!app) return "(no columns)";
    const rect = app.getBoundingClientRect();
    return `${px(rect.height)} tall, bottom at ${px(rect.bottom)}`;
}

function isEnabled(): boolean {
    try {
        return (
            new URLSearchParams(window.location.search).has("metrics") || localStorage.getItem("mx_tg_metrics") === "1"
        );
    } catch {
        return false;
    }
}

export function TgMetricsPanel(): JSX.Element | null {
    const enabled = isEnabled();
    const [metrics, setMetrics] = useState<Metric[]>([]);
    const [open, setOpen] = useState(true);

    useEffect(() => {
        if (!enabled) return;
        // Read through a local, as viewportHeight.ts does: these are the browser's own numbers, which is
        // the one thing UIStore cannot stand in for here.
        const win: Window = window;
        const visual = win.visualViewport;
        const update = (): void => setMetrics(readMetrics(win));
        update();
        // Everything here changes with the viewport, the keyboard, or a re-render that writes the blocks.
        const timer = win.setInterval(update, 500);
        win.addEventListener("resize", update);
        visual?.addEventListener("resize", update);
        visual?.addEventListener("scroll", update);
        return () => {
            win.clearInterval(timer);
            win.removeEventListener("resize", update);
            visual?.removeEventListener("resize", update);
            visual?.removeEventListener("scroll", update);
        };
    }, [enabled]);

    if (!enabled) return null;
    return (
        <div className="mx_TgMetricsPanel" data-open={open}>
            <button type="button" className="mx_TgMetricsPanel_toggle" onClick={() => setOpen((o) => !o)}>
                {open ? "metrics ×" : "metrics"}
            </button>
            {open && (
                <dl>
                    {metrics.map((m) => (
                        <React.Fragment key={m.name}>
                            <dt>{m.name}</dt>
                            <dd>{m.value}</dd>
                        </React.Fragment>
                    ))}
                </dl>
            )}
        </div>
    );
}
