/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Chat-list column width, ported from Telegram Web K (GPL-3.0):
 *   src/helpers/updateColumnWidths.ts   preference load / clamp / throttled persist, visual width
 *   src/helpers/installColumnResize.ts  drag → width, collapse threshold
 */

import { throttle } from "lodash";

import {
    DEFAULT_COLUMN_WIDTH,
    MAX_SIDEBAR_WIDTH,
    MIN_SIDEBAR_WIDTH,
    PERSIST_THROTTLE_MS,
    SIDEBAR_COLLAPSE_FACTOR,
    SIDEBAR_COLLAPSED_WIDTH,
    STORAGE_KEY_LEFT,
} from "./constants";
import { ScreenSize } from "./mediaSizes";

/** A left-column preference: `width` undefined means "use the default". */
export interface LeftColumnPreference {
    collapsed: boolean;
    width?: number;
}

export function clampSidebarWidth(width: number): number {
    return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width));
}

/** tweb updateColumnWidths.ts loadUserPreferences: "0" is collapsed, anything else clamped. */
export function parseLeftPreference(raw: string | null): LeftColumnPreference {
    if (raw == null) return { collapsed: false };
    const n = parseInt(raw, 10);
    if (isNaN(n)) return { collapsed: false };
    if (n === 0) return { collapsed: true };
    return { collapsed: false, width: clampSidebarWidth(n) };
}

/** tweb persistLeftPreference: the collapsed state is stored as 0. */
export function serialiseLeftPreference(pref: LeftColumnPreference): string {
    return String(pref.collapsed ? 0 : pref.width);
}

/**
 * tweb installColumnResize.ts onSwipe (left side) + setUserPreferredLeft: the preference a drag to
 * `rawWidth` (distance from the column's outer edge to the pointer) produces.
 */
export function preferenceForDrag(rawWidth: number, preventCollapse = false): LeftColumnPreference {
    const collapsed = !preventCollapse && rawWidth < MIN_SIDEBAR_WIDTH * SIDEBAR_COLLAPSE_FACTOR;
    if (collapsed || rawWidth <= 0) return { collapsed: true };
    return { collapsed: false, width: clampSidebarWidth(rawWidth) };
}

/** tweb updateColumnWidths.ts computeVisualLeftWidth (without the tabs-open override). */
export function visualLeftWidth(pref: LeftColumnPreference, screen: ScreenSize, viewportWidth: number): number {
    const defaultColumnWidth = Math.min(viewportWidth, DEFAULT_COLUMN_WIDTH);
    if (screen === ScreenSize.mobile) return viewportWidth;
    if (screen === ScreenSize.medium) return defaultColumnWidth;
    if (pref.collapsed) return SIDEBAR_COLLAPSED_WIDTH;
    return pref.width ?? defaultColumnWidth;
}

/** Whether the column renders avatars-only (tweb: collapsed preference, never on handhelds or in the floating range). */
export function isEffectivelyCollapsed(pref: LeftColumnPreference, screen: ScreenSize): boolean {
    return pref.collapsed && screen === ScreenSize.large;
}

function getStorage(): Storage | undefined {
    try {
        return window.localStorage;
    } catch {
        return undefined;
    }
}

export function loadLeftPreference(storage: Storage | undefined = getStorage()): LeftColumnPreference {
    return parseLeftPreference(storage?.getItem(STORAGE_KEY_LEFT) ?? null);
}

/** Throttled like tweb's persistLeftPreference, so a drag writes at most every 200 ms. */
export function createLeftPreferencePersister(
    storage: Storage | undefined = getStorage(),
): ((pref: LeftColumnPreference) => void) & { flush(): void; cancel(): void } {
    let latest: LeftColumnPreference | undefined;
    const write = throttle(() => {
        if (latest) storage?.setItem(STORAGE_KEY_LEFT, serialiseLeftPreference(latest));
    }, PERSIST_THROTTLE_MS);
    const persist = (pref: LeftColumnPreference): void => {
        latest = pref;
        write();
    };
    return Object.assign(persist, { flush: () => write.flush(), cancel: () => write.cancel() });
}
