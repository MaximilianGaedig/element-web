/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";
import { type Room } from "matrix-js-sdk/src/matrix";

import { BACKFILL_EVENT_TYPE, backfillStatusOf } from "./chatHistory";

function roomWith(content: unknown): Room {
    return {
        currentState: {
            getStateEvents: (type: string, key: string) =>
                type === BACKFILL_EVENT_TYPE && key === "" && content ? { getContent: () => content } : null,
        },
    } as unknown as Room;
}

describe("backfillStatusOf", () => {
    it("reads what the bridge recorded", () => {
        const status = backfillStatusOf(
            roomWith({
                state: "running",
                bridged_messages: 1200,
                oldest_ts: 1_600_000_000_000,
                remote_total: 5000,
                batches: 3,
                command_prefix: "!tg",
                network: "Telegram",
                updated_ts: 1,
            }),
        );
        expect(status).toMatchObject({
            state: "running",
            bridged_messages: 1200,
            remote_total: 5000,
            command_prefix: "!tg",
            network: "Telegram",
        });
    });

    it("says nothing for a room the bridge never described", () => {
        expect(backfillStatusOf(roomWith(undefined))).toBeUndefined();
    });

    it("ignores a state it doesn't know", () => {
        expect(backfillStatusOf(roomWith({ state: "sideways" }))).toBeUndefined();
    });
});
