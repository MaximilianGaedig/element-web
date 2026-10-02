/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { ConnectionError, type MatrixError, type MatrixEvent, MatrixScheduler } from "matrix-js-sdk/src/matrix";

/*
 * When a send that failed is tried again: as Telegram Web does it.
 *
 * The SDK's own rule retries a send the server answered badly, and gives up at once on one that never
 * got an answer - a dropped connection - leaving the message "not sent" for the reader to send again by
 * hand. But no answer is the ordinary failure, not the hopeless one: a browser aborts every request in
 * flight when the machine's network changes at all (Wi-Fi roaming to another access point, a VPN or a
 * container bringing an interface up) and is back a moment later, and a message written in that moment
 * stayed unsent though the very next request would have gone through.
 *
 * Telegram Web (tweb, GPL-3.0; src/lib/mtproto/networker.ts, src/lib/appManagers/appMessagesManager.ts)
 * draws the line between the two the other way round:
 *
 *  - a message that got no answer stays "sending". The network layer keeps it (pendingMessages) and
 *    sends it again whenever the connection is back (resend() after checkConnection succeeds), however
 *    long that takes. It probes for the connection at intervals that grow by half each time, up to
 *    fifteen seconds (checkConnectionPeriod = min(CHECK_CONNECTION_MAX_PERIOD, (1 + period) * 1.5));
 *  - a message the server refused (an ApiError) is marked failed at once, and is the reader's to resend;
 *  - none of it outlives the page: pending messages are held in memory (pendingByRandomId), so a reload
 *    sends nothing by itself later. Here an unsent message does survive a reload - it is restored as
 *    "not sent", which is more than Telegram Web keeps - and is likewise never sent unasked (see
 *    unsentResender.ts).
 *
 * Trying again is safe: a send carries a transaction ID, and the server takes the same one only once.
 */

/** tweb's CHECK_CONNECTION_MAX_PERIOD, in ms: the longest wait between two tries. */
export const NO_ANSWER_MAX_DELAY_MS = 15_000;

/** The SDK's own rule, by a name that can be called: it is a static of the scheduler, written in capitals. */
export const sdkSendRetryDelay = MatrixScheduler.RETRY_BACKOFF_RATELIMIT;

/**
 * How long to wait before the next try of a send that got no answer: tweb's sequence, in which each
 * wait is one second more than the last and then half as long again (1.5 s, 3.75 s, 7.1 s, 12.2 s) until
 * it reaches the maximum, where it stays.
 * @param attempts - how many times the send has failed so far; at least 1.
 */
export function noAnswerRetryDelay(attempts: number): number {
    let seconds = 0;
    for (let i = 0; i < attempts && seconds < NO_ANSWER_MAX_DELAY_MS / 1000; i++) {
        seconds = Math.min(NO_ANSWER_MAX_DELAY_MS / 1000, (1 + seconds) * 1.5);
    }
    return Math.round(seconds * 1000);
}

/**
 * The scheduler's retry rule: how long to wait before trying this send again, or -1 to give up.
 * @param attempts - how many times it has failed so far; at least 1.
 */
export function sendRetryDelay(event: MatrixEvent | null, attempts: number, err: MatrixError): number {
    // No answer: it stays "sending" and is tried again for as long as the page is open.
    if ((err as unknown) instanceof ConnectionError) return noAnswerRetryDelay(attempts);
    // An answer: the SDK's rule, which gives up at once on a refusal and retries a busy server a few times.
    return sdkSendRetryDelay(event, attempts, err);
}

/** The scheduler the client sends with: the SDK's own queueing, and the retry rule above. */
export function createSendScheduler(): MatrixScheduler {
    return new MatrixScheduler(sendRetryDelay);
}
