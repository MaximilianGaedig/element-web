/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { EventStatus, type MatrixEvent } from "matrix-js-sdk/src/matrix";

/**
 * Which of a room's pending events belong on screen.
 *
 * At the live end, all of them: one being sent belongs at the bottom, which is where the reader is.
 * Away from it, only the ones that failed.
 *
 * Upstream shows none at all away from the live end, which is right for a message in flight - the reader
 * is looking at history and it would appear somewhere it does not belong. A message that *failed* is
 * different: it is the reader's own text, it will never arrive by pagination, and after a gappy sync the
 * window reports that it can paginate forwards while the reader believes they are at the bottom. That
 * combination put five typed messages nowhere on screen, with the "not sent" banner suppressed because a
 * one-to-one chat shows the error on the bubble - and there was no bubble.
 */
export function pendingEventsToShow(pending: readonly MatrixEvent[], atLiveEnd: boolean): MatrixEvent[] {
    if (atLiveEnd) return [...pending];
    return pending.filter((event) => event.status === EventStatus.NOT_SENT);
}
