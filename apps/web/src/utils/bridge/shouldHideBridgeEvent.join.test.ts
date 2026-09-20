/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it, vi } from "vitest";
import { MatrixEvent } from "matrix-js-sdk/src/matrix";

import { MatrixClientPeg } from "../../MatrixClientPeg";
import { shouldHideBridgeEvent } from "./shouldHideBridgeEvent";

function member(sender: string, membership: string, stateKey = sender): MatrixEvent {
    return new MatrixEvent({
        type: "m.room.member",
        room_id: "!r:x",
        sender,
        state_key: stateKey,
        content: { membership },
    });
}

function clientWith(bridged: boolean): void {
    vi.spyOn(MatrixClientPeg, "get").mockReturnValue({
        getUserId: () => "@me:x",
        getSafeUserId: () => "@me:x",
        getRoom: () => ({
            // The bridge publishes its import status as room account data (state is only the old fallback).
            getAccountData: (type: string) =>
                type === "im.mxg.backfill" && bridged ? { getContent: () => ({ state: "complete" }) } : undefined,
            currentState: { getStateEvents: () => null },
        }),
    } as never);
}

describe("bridged joins and leaves", () => {
    it("hides other people's joins and leaves in a bridged chat", () => {
        clientWith(true);
        expect(shouldHideBridgeEvent(member("@ghost:x", "join"))).toBe(true);
        expect(shouldHideBridgeEvent(member("@ghost:x", "leave"))).toBe(true);
    });

    it("keeps your own, and invites and kicks", () => {
        clientWith(true);
        expect(shouldHideBridgeEvent(member("@me:x", "join"))).toBe(false);
        expect(shouldHideBridgeEvent(member("@admin:x", "leave", "@ghost:x"))).toBe(false);
        expect(shouldHideBridgeEvent(member("@admin:x", "invite", "@ghost:x"))).toBe(false);
    });

    it("leaves ordinary chats alone", () => {
        clientWith(false);
        expect(shouldHideBridgeEvent(member("@someone:x", "join"))).toBe(false);
    });
});
