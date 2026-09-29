/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it, vi, afterEach } from "vitest";
import { type Room } from "matrix-js-sdk/src/matrix";

import { telegramTicksShown } from "./telegramLayout";
import { Layout } from "../../settings/enums/Layout";

/*
 * A real room rather than a mocked isOneToOneRoom: the call is inside the same module, so spying on the
 * export never intercepts it - a mock there passes while proving nothing. Member counts decide, and
 * getBridgeInfo reads m.bridge off the state, so an empty state is an unbridged room.
 */
const roomOf = (members: number): Room =>
    ({
        currentState: { getStateEvents: () => [] },
        getJoinedMemberCount: () => members,
        getInvitedAndJoinedMemberCount: () => members,
        getMember: () => null,
    }) as unknown as Room;

const dm = (): Room => roomOf(2);
const group = (): Room => roomOf(5);

afterEach(() => vi.restoreAllMocks());

describe("telegramTicksShown", () => {
    it("shows ticks in a one-to-one chat whatever the receipt style", () => {
        expect(
            telegramTicksShown({ room: dm(), layout: Layout.Bubble, bubbles: true, readReceiptsStyle: "avatars" }),
        ).toBe(true);
    });

    it("shows ticks in a group when the reader asked for ticks", () => {
        expect(
            telegramTicksShown({ room: group(), layout: Layout.Bubble, bubbles: true, readReceiptsStyle: "ticks" }),
        ).toBe(true);
    });

    /*
     * The case that hid failed sends: bubbles on, group chat, and the default "avatars" style. No ticks,
     * so the failure has nowhere to show - and the status bar must therefore keep its banner.
     */
    it("shows no ticks in a group on the default receipt style", () => {
        expect(
            telegramTicksShown({ room: group(), layout: Layout.Bubble, bubbles: true, readReceiptsStyle: "avatars" }),
        ).toBe(false);
    });

    it("shows no ticks outside the bubble layout, however the receipts are set", () => {
        expect(
            telegramTicksShown({ room: dm(), layout: Layout.Group, bubbles: true, readReceiptsStyle: "ticks" }),
        ).toBe(false);
        expect(telegramTicksShown({ room: dm(), layout: undefined, bubbles: true, readReceiptsStyle: "ticks" })).toBe(
            false,
        );
    });

    it("shows no ticks with the Telegram layout off", () => {
        expect(
            telegramTicksShown({ room: dm(), layout: Layout.Bubble, bubbles: false, readReceiptsStyle: "ticks" }),
        ).toBe(false);
    });

    it("shows no ticks without a room", () => {
        expect(
            telegramTicksShown({ room: null, layout: Layout.Bubble, bubbles: true, readReceiptsStyle: "ticks" }),
        ).toBe(false);
    });
});
