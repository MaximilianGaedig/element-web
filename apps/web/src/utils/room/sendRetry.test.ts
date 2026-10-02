/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";
import { ConnectionError, MatrixError } from "matrix-js-sdk/src/matrix";

import {
    NO_ANSWER_MAX_DELAY_MS,
    createSendScheduler,
    noAnswerRetryDelay,
    sdkSendRetryDelay,
    sendRetryDelay,
} from "./sendRetry";

const dropped = new ConnectionError("fetch failed") as unknown as MatrixError;

/*
 * A message written in the instant the machine's network changed was aborted by the browser, never
 * tried again, and stayed "not sent" - though the connection was back a second later.
 */
describe("retrying a send", () => {
    it("waits as Telegram Web does between tries: a second more, then half as long again, up to fifteen", () => {
        // tweb: checkConnectionPeriod = min(15, (1 + checkConnectionPeriod) * 1.5), from 0.
        expect([1, 2, 3, 4, 5, 6].map(noAnswerRetryDelay)).toEqual([1500, 3750, 7125, 12188, 15000, 15000]);
        expect(NO_ANSWER_MAX_DELAY_MS).toBe(15_000);
    });

    it("keeps trying a send that got no answer for as long as the page is open", () => {
        expect(sendRetryDelay(null, 1, dropped)).toBe(1500);
        // An hour of a train tunnel later it is still being tried, at the longest wait and no longer.
        expect(sendRetryDelay(null, 250, dropped)).toBe(NO_ANSWER_MAX_DELAY_MS);
        expect(sendRetryDelay(null, 100_000, dropped)).toBe(NO_ANSWER_MAX_DELAY_MS);
    });

    it("gives up at once on a send the server refused, which is the reader's to send again", () => {
        const refused = new MatrixError({ errcode: "M_FORBIDDEN" }, 403);
        const tooLarge = new MatrixError({ errcode: "M_TOO_LARGE" }, 413);
        expect(sendRetryDelay(null, 1, refused)).toBe(-1);
        expect(sendRetryDelay(null, 1, tooLarge)).toBe(-1);
    });

    it("is what the SDK does by itself for every answer the server gives", () => {
        // The SDK gives up at once on a dropped connection: the thing being changed.
        expect(sdkSendRetryDelay(null, 1, dropped)).toBe(-1);

        const refused = new MatrixError({ errcode: "M_FORBIDDEN" }, 403);
        const busy = new MatrixError({ errcode: "M_UNKNOWN" }, 502);
        const limited = new MatrixError({ errcode: "M_LIMIT_EXCEEDED", retry_after_ms: 3000 }, 429);
        for (const err of [refused, busy, limited]) {
            for (const attempts of [1, 2, 5]) {
                expect(sendRetryDelay(null, attempts, err)).toBe(sdkSendRetryDelay(null, attempts, err));
            }
        }
        // A server that was busy is tried again a few times and then given up on.
        expect(sendRetryDelay(null, 1, busy)).toBeGreaterThan(0);
        expect(sendRetryDelay(null, 5, busy)).toBe(-1);
    });

    it("gives the client a scheduler that uses it", () => {
        expect(createSendScheduler().retryAlgorithm).toBe(sendRetryDelay);
    });
});
