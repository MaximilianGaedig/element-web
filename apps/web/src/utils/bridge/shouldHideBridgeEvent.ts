/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type MatrixEvent } from "matrix-js-sdk/src/matrix";

import { MatrixClientPeg } from "../../MatrixClientPeg";
import { hasDisappeared } from "./disappearingMessages";

/** Set by bridges on state changes that are bookkeeping, e.g. syncing members or implicit names. */
export const EXCLUDE_FROM_TIMELINE_KEY = "com.beeper.exclude_from_timeline";
/** Set on a redaction to say the deleted message should vanish rather than leave a placeholder. */
export const DONT_RENDER_REDACTED_KEY = "com.beeper.dont_render_redacted_placeholder";

/** A disappearing message whose timer has run out (the bridge redacts it soon, but don't wait). */
export function isDisappeared(ev: MatrixEvent): boolean {
    const client = MatrixClientPeg.get();
    if (!client) return false;
    return hasDisappeared(ev, client.getRoom(ev.getRoomId()), client.getSafeUserId());
}

/**
 * Timeline hiding rules for mautrix bridge extensions, consulted by shouldHideEvent.
 */
export function shouldHideBridgeEvent(ev: MatrixEvent): boolean {
    if (ev.isState() && ev.getContent()[EXCLUDE_FROM_TIMELINE_KEY] === true) return true;
    // Thread roots stay visible so the thread remains reachable, as in shouldHideEvent.
    if (ev.isRedacted() && !ev.getThread()) {
        const redaction = ev.getRedactionEvent();
        if (redaction && "content" in redaction && redaction.content?.[DONT_RENDER_REDACTED_KEY] === true) {
            return true;
        }
    }
    return isDisappeared(ev);
}
