/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { useCallback, useEffect, useRef, useState } from "react";

/** As long as the animation that takes something off the screen, before it stops being rendered. */
const LEAVING_FOR = 200;

/**
 * Keeps something on screen long enough to animate away.
 *
 * A layer that is simply stopped being rendered disappears: whatever it was animated in with, going back
 * has nothing to play because the element is already gone. This holds it for the length of the outgoing
 * animation, marked so the CSS can run that animation, and then lets it go.
 *
 * Returns whether to render it, whether it is on its way out, and the function to start that - so the
 * caller's own state is only cleared once there is nothing left to see.
 */
export function useLeaving(
    shown: boolean,
    onGone: () => void,
    ms: number = LEAVING_FOR,
): {
    render: boolean;
    leaving: boolean;
    leave: () => void;
} {
    const [leaving, setLeaving] = useState(false);
    const timer = useRef(0);

    useEffect(() => {
        // Shown again while it was leaving - reopened before it finished - is not leaving any more.
        if (shown) setLeaving(false);
    }, [shown]);

    useEffect(() => () => window.clearTimeout(timer.current), []);

    const leave = useCallback((): void => {
        setLeaving(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
            setLeaving(false);
            onGone();
        }, ms);
    }, [onGone, ms]);

    return { render: shown || leaving, leaving, leave };
}
