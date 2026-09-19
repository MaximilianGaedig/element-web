/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { useSyncExternalStore } from "react";

/**
 * One clock for every presence display (room list tags, header "last seen", user info), so they all
 * read the same "now" and can never disagree ("6m" next to "5 minutes ago"). It ticks while anything
 * listens and the page is visible, and jumps forward as soon as the page is shown again (tab switch,
 * PWA resumed, phone unlocked) instead of waiting for a throttled timer.
 */
const TICK_MS = 5_000;

let now = Date.now();
let timer: number | undefined;
const listeners = new Set<() => void>();

function tick(): void {
    now = Date.now();
    for (const l of listeners) l();
}

function onVisibility(): void {
    if (document.visibilityState === "hidden") {
        window.clearInterval(timer);
        timer = undefined;
        return;
    }
    tick();
    if (timer === undefined) timer = window.setInterval(tick, TICK_MS);
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    if (listeners.size === 1) {
        document.addEventListener("visibilitychange", onVisibility);
        window.addEventListener("focus", onVisibility);
        window.addEventListener("pageshow", onVisibility);
        onVisibility();
    }
    return () => {
        listeners.delete(listener);
        if (listeners.size > 0) return;
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("focus", onVisibility);
        window.removeEventListener("pageshow", onVisibility);
        window.clearInterval(timer);
        timer = undefined;
    };
}

/** The shared presence clock's current time. */
export function presenceNow(): number {
    return now;
}

/** Re-renders with the shared presence clock. */
export function usePresenceNow(): number {
    return useSyncExternalStore(subscribe, presenceNow);
}

/** Whole minutes since `ts` (what both the tag and the "last seen" text show). */
export function minutesSince(ts: number, at: number): number {
    return Math.floor(Math.max(0, at - ts) / 60_000);
}
