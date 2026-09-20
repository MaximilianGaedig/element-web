/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Screen-size tiers, ported from Telegram Web K src/helpers/mediaSizes.ts (GPL-3.0): the same three
 * breakpoints and the same tier computation.
 */

import { useSyncExternalStore } from "react";

import UIStore, { UI_EVENTS } from "../../../stores/UIStore";
import { FLOATING_LEFT_SIDEBAR_SIZE, LARGE_SIZE, MOBILE_SIZE } from "./constants";

export enum ScreenSize {
    mobile = "mobile",
    medium = "medium",
    large = "large",
}

const SCREEN_SIZES: { key: ScreenSize; value: number }[] = [
    { key: ScreenSize.mobile, value: MOBILE_SIZE },
    { key: ScreenSize.medium, value: FLOATING_LEFT_SIDEBAR_SIZE },
    { key: ScreenSize.large, value: LARGE_SIZE },
];

/** tweb MediaSizes.handleResize: the tier for a viewport `innerWidth` wide. */
export function getScreenSize(innerWidth: number): ScreenSize {
    let activeScreen = SCREEN_SIZES[0].key;
    for (let i = SCREEN_SIZES.length - 1; i >= 0; --i) {
        if (SCREEN_SIZES[i].value < innerWidth) {
            activeScreen = (SCREEN_SIZES[i + 1] || SCREEN_SIZES[i]).key;
            break;
        }
    }
    return activeScreen;
}

/** tweb MediaSizes.isLessThanFloatingLeftSidebar. */
/** @knipignore Kept beside the other breakpoint helpers and covered by tests; the layout may need it again. */
export function isLessThanFloatingLeftSidebar(innerWidth: number): boolean {
    return innerWidth <= FLOATING_LEFT_SIDEBAR_SIZE;
}

type Listener = () => void;
const listeners = new Set<Listener>();
let current: ScreenSize | undefined;

/** The viewport width, read through UIStore (which tracks the body with a ResizeObserver). */
export function viewportWidth(): number {
    return UIStore.instance.windowWidth;
}

function read(): ScreenSize {
    return getScreenSize(viewportWidth());
}

// tweb re-evaluates on a rAF after window resize; UIStore's ResizeObserver already fires once per frame.
function onResize(): void {
    const next = read();
    if (next === current) return;
    current = next;
    listeners.forEach((l) => l());
}

function subscribe(listener: Listener): () => void {
    if (!listeners.size) UIStore.instance.on(UI_EVENTS.Resize, onResize);
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
        if (!listeners.size) UIStore.instance.off(UI_EVENTS.Resize, onResize);
    };
}

function getSnapshot(): ScreenSize {
    // Re-read while nobody is subscribed so a stale value never outlives a resize we did not see.
    if (current === undefined || !listeners.size) current = read();
    return current;
}

/** The current screen tier, re-rendering on tier changes only. */
export function useScreenSize(): ScreenSize {
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
