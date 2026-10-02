/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";
import { ConnectionError, MatrixError } from "matrix-js-sdk/src/matrix";

import { NO_ANSWER_RETRY_DELAYS_MS, createSendScheduler, sdkSendRetryDelay, sendRetryDelay } from "./sendRetry";

const dropped = new ConnectionError("fetch failed") as unknown as MatrixError;

/*
 * A message written in the instant the machine's network changed was aborted by the browser, never
 * tried again, and stayed "not sent" - though the connection was back a second later.
 */
describe("retrying a send", () => {
    it("tries a send that got no answer again, soon at first, and then gives up", () => {
        expect(sendRetryDelay(null, 1, dropped)).toBe(500);
        expect(NO_ANSWER_RETRY_DELAYS_MS.map((_, index) => sendRetryDelay(null, index + 1, dropped))).toEqual([
            ...NO_ANSWER_RETRY_DELAYS_MS,
        ]);
        // Each wait is longer than the last, and the last try is not the first of an endless run.
        expect([...NO_ANSWER_RETRY_DELAYS_MS]).toEqual([...NO_ANSWER_RETRY_DELAYS_MS].sort((a, b) => a - b));
        expect(sendRetryDelay(null, NO_ANSWER_RETRY_DELAYS_MS.length + 1, dropped)).toBe(-1);
    });

    it("is what the SDK does by itself for everything else", () => {
        // The SDK gives up at once on a dropped connection: the thing being changed.
        expect(sdkSendRetryDelay(null, 1, dropped)).toBe(-1);

        const refused = new MatrixError({ errcode: "M_FORBIDDEN" }, 403);
        const tooLarge = new MatrixError({ errcode: "M_TOO_LARGE" }, 413);
        const busy = new MatrixError({ errcode: "M_UNKNOWN" }, 502);
        const limited = new MatrixError({ errcode: "M_LIMIT_EXCEEDED", retry_after_ms: 3000 }, 429);
        for (const err of [refused, tooLarge, busy, limited]) {
            for (const attempts of [1, 2, 5]) {
                expect(sendRetryDelay(null, attempts, err)).toBe(sdkSendRetryDelay(null, attempts, err));
            }
        }
        // A refusal is never retried; a server that was busy is.
        expect(sendRetryDelay(null, 1, refused)).toBe(-1);
        expect(sendRetryDelay(null, 1, busy)).toBeGreaterThan(0);
    });

    it("gives the client a scheduler that uses it", () => {
        expect(createSendScheduler().retryAlgorithm).toBe(sendRetryDelay);
    });
});
