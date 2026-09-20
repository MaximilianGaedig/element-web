/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type MatrixEvent } from "matrix-js-sdk/src/matrix";

import { MatrixClientPeg } from "../../MatrixClientPeg";
import { hasDisappeared } from "./disappearingMessages";
import { backfillStatusOf } from "../chatHistory";

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
 * In a bridged chat, other people joining and leaving is the bridge tracking who is in the chat on the
 * other network, not something anyone did here, and an import of old history brings a "joined" for every
 * person who ever wrote in it. Those are hidden (your own, and invites, kicks and bans, still show).
 */
function isBridgedSelfJoinOrLeave(ev: MatrixEvent): boolean {
    if (ev.getType() !== "m.room.member" || ev.getStateKey() !== ev.getSender()) return false;
    const membership = ev.getContent().membership;
    if (membership !== "join" && membership !== "leave") return false;
    const client = MatrixClientPeg.get();
    const room = client?.getRoom(ev.getRoomId());
    return !!room && ev.getStateKey() !== client?.getUserId() && !!backfillStatusOf(room);
}

/**
 * Timeline hiding rules for mautrix bridge extensions, consulted by shouldHideEvent.
 */
export function shouldHideBridgeEvent(ev: MatrixEvent): boolean {
    if (ev.isState() && ev.getContent()[EXCLUDE_FROM_TIMELINE_KEY] === true) return true;
    if (isBridgedSelfJoinOrLeave(ev)) return true;
    // Thread roots stay visible so the thread remains reachable, as in shouldHideEvent.
    if (ev.isRedacted() && !ev.getThread()) {
        const redaction = ev.getRedactionEvent();
        if (redaction && "content" in redaction && redaction.content?.[DONT_RENDER_REDACTED_KEY] === true) {
            return true;
        }
    }
    return isDisappeared(ev);
}
