/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { ConnectionError, type MatrixError, type MatrixEvent, MatrixScheduler } from "matrix-js-sdk/src/matrix";

/*
 * When a send that failed is tried again.
 *
 * The SDK's own rule retries a send the server answered badly, and gives up at once on one that never
 * got an answer - a dropped connection - leaving the message "not sent" for the reader to send again by
 * hand. But a connection that drops for an instant is the ordinary case, not the hopeless one: a browser
 * aborts every request in flight when the machine's network changes at all (Wi-Fi roaming to another
 * access point, a VPN or a container bringing an interface up), and is back on the network a moment
 * later. A message written in that moment stayed unsent, though the very next request would have gone
 * through.
 *
 * So a send that got no answer is tried again a few times, soon at first, before it is given up on.
 * Trying again is safe: a send carries a transaction ID, and the server takes the same one only once.
 */

/** The SDK's own rule, by a name that can be called: it is a static of the scheduler, written in capitals. */
export const sdkSendRetryDelay = MatrixScheduler.RETRY_BACKOFF_RATELIMIT;

/** How long to wait before each further try of a send that got no answer, in ms. Then it is given up on. */
export const NO_ANSWER_RETRY_DELAYS_MS = [500, 1500, 4000, 8000, 16000] as const;

/**
 * The scheduler's retry rule: how long to wait before trying this send again, or -1 to give up.
 * @param attempts - how many times it has failed so far; at least 1.
 */
export function sendRetryDelay(event: MatrixEvent | null, attempts: number, err: MatrixError): number {
    if ((err as unknown) instanceof ConnectionError) {
        return NO_ANSWER_RETRY_DELAYS_MS[attempts - 1] ?? -1;
    }
    return sdkSendRetryDelay(event, attempts, err);
}

/** The scheduler the client sends with: the SDK's own queueing, and the retry rule above. */
export function createSendScheduler(): MatrixScheduler {
    return new MatrixScheduler(sendRetryDelay);
}
