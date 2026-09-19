/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useLayoutEffect, useRef } from "react";
import classNames from "classnames";

import { ACTIVITY_FADE_MS } from "../../../utils/presence/activity";

interface Props {
    /** 0–1 from activityLevel(): 1 = online, falling towards 0 over the hour after the user was last active. */
    level: number;
    className?: string;
    label?: string;
}

/** Minutes since the user was last active, from an activity level (which fades over ACTIVITY_FADE_MS). */
export function activityMinutes(level: number): number {
    return Math.max(1, Math.round(((1 - level) * ACTIVITY_FADE_MS) / 60000));
}

/**
 * Presence badge, the way Messenger and Facebook show it: a green dot while the user is online, and
 * for someone who was active within the last hour a small green "12m" tag instead. Pops in with
 * Telegram Web K's badge transition.
 */
/** Fired (on window) when a presence tweak changes, so cut-outs are redrawn. */
export const PRESENCE_TWEAKS_EVENT = "mx_tg_presence_tweaks";

/**
 * The avatar's cut-out around a badge as an SVG mask: the whole box minus the badge's pill (a circle for
 * the dot) grown by --PresenceDot-gap, one even-odd path so the edge is a crisp vector one. Geometry comes
 * from the badge's layout box (its right/bottom offsets and size), so the pop-in transform doesn't move it.
 */
export function presenceCutout(host: HTMLElement, badge: HTMLElement): string | undefined {
    const size = host.clientWidth;
    const cs = getComputedStyle(badge);
    const w = parseFloat(cs.width);
    const h = parseFloat(cs.height);
    const x = size - (parseFloat(cs.right) || 0) - w;
    const y = host.clientHeight - (parseFloat(cs.bottom) || 0) - h;
    // Not laid out (hidden, or no layout at all): keep the CSS fallback.
    if (!size || !host.clientHeight || !(w > 0) || !(h > 0)) return undefined;
    const gap = parseFloat(getComputedStyle(host).getPropertyValue("--PresenceDot-gap")) || 0;
    const r = Math.min(w, h) / 2 + gap;
    const left = x - gap;
    const top = y - gap;
    const right = x + w + gap;
    const bottom = y + h + gap;
    const n = (v: number): string => String(Math.round(v * 1000) / 1000);
    const pill =
        `M${n(left + r)} ${n(top)}H${n(right - r)}A${n(r)} ${n(r)} 0 0 1 ${n(right - r)} ${n(bottom)}` +
        `H${n(left + r)}A${n(r)} ${n(r)} 0 0 1 ${n(left + r)} ${n(top)}Z`;
    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${host.clientHeight}" preserveAspectRatio="none">` +
        `<path fill-rule="evenodd" d="M-99 -99H${size + 99}V${host.clientHeight + 99}H-99Z${pill}"/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export function ActivityDot({ level, className, label }: Props): JSX.Element | null {
    const badge = useRef<HTMLSpanElement>(null);
    const shown = level > 0;
    const online = level >= 1;
    // Publish the cut-out on the avatar view (_ActivityDot.pcss uses it as the avatar's mask), redrawn when
    // the badge resizes ("1m" vs "59m"), the avatar resizes, or a tweak changes.
    useLayoutEffect(() => {
        const el = badge.current;
        const host = el?.parentElement;
        if (!shown || !el || !host) return;
        const update = (): void => {
            const mask = presenceCutout(host, el);
            if (mask) host.style.setProperty("--PresenceBadge-mask", mask);
            else host.style.removeProperty("--PresenceBadge-mask");
        };
        update();
        window.addEventListener(PRESENCE_TWEAKS_EVENT, update);
        const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
        observer?.observe(el);
        observer?.observe(host);
        return () => {
            window.removeEventListener(PRESENCE_TWEAKS_EVENT, update);
            observer?.disconnect();
            host.style.removeProperty("--PresenceBadge-mask");
        };
    }, [shown, online]);

    if (!shown) return null;
    if (online) {
        return <span ref={badge} className={classNames("mx_ActivityDot", className)} role="img" aria-label={label} />;
    }
    return (
        <span
            ref={badge}
            className={classNames("mx_ActivityDot mx_ActivityDot_recent", className)}
            role="img"
            aria-label={label}
        >
            {activityMinutes(level)}m
        </span>
    );
}
