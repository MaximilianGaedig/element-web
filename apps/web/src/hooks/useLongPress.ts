/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { useCallback, useEffect, useRef } from "react";

/** Long enough not to fire while scrolling past, short enough to feel like a press and hold. */
const HELD_FOR = 500;

/**
 * A press and hold, which is what a right-click is on a touch screen.
 *
 * Returns the handlers to spread onto the element that should respond to being held. The timer lives in a
 * ref rather than in a value captured by the handlers: a plain object recreated on each render is a
 * different object by the time the press ends, so the press that started could never be cancelled - and it
 * is cleared when the element goes away, so a row scrolled out mid-press cannot open a menu for itself
 * afterwards.
 */
export function useLongPress(onLongPress: () => void, ms: number = HELD_FOR): {
    onTouchStart: () => void;
    onTouchEnd: () => void;
    onTouchMove: () => void;
} {
    const timer = useRef(0);
    const stop = useCallback((): void => {
        window.clearTimeout(timer.current);
        timer.current = 0;
    }, []);

    useEffect(() => stop, [stop]);

    return {
        onTouchStart: useCallback((): void => {
            stop();
            timer.current = window.setTimeout(onLongPress, ms);
        }, [onLongPress, ms, stop]),
        onTouchEnd: stop,
        onTouchMove: stop,
    };
}
