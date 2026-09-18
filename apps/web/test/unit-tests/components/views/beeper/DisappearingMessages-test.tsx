/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React from "react";
import { act, render, screen } from "jest-matrix-react";
import { type MatrixClient, MatrixEvent, PendingEventOrdering, ReceiptType, Room } from "matrix-js-sdk/src/matrix";

import DisappearingMessageBadge from "../../../../../src/components/views/beeper/DisappearingMessageBadge";
import { DisappearingTimerHeaderBadge } from "../../../../../src/components/views/beeper/BeeperRoomHeaderBadges";
import MatrixClientContext from "../../../../../src/contexts/MatrixClientContext";
import { MatrixClientPeg } from "../../../../../src/MatrixClientPeg";
import shouldHideEvent from "../../../../../src/shouldHideEvent";
import { mkEvent, stubClient } from "../../../../test-utils";
import {
    DISAPPEARING_TIMER_KEY,
    formatDisappearingDuration,
    getDisappearingExpiry,
    parseDisappearingTimer,
} from "../../../../../src/utils/beeper/disappearingMessages";

const ROOM_ID = "!portal:example.org";
const GHOST = "@signal_abc:example.org";
const NOW = 1_700_000_000_000;

describe("disappearing messages", () => {
    let client: MatrixClient;
    let room: Room;

    const mkMsg = (timer: unknown, opts: { sender?: string; ts?: number; id?: string } = {}): MatrixEvent => {
        const ev = mkEvent({
            event: true,
            type: "m.room.message",
            room: ROOM_ID,
            user: opts.sender ?? GHOST,
            id: opts.id ?? "$msg",
            ts: opts.ts ?? NOW,
            content: { msgtype: "m.text", body: "secret", [DISAPPEARING_TIMER_KEY]: timer },
        });
        room.addLiveEvents([ev], { addToState: false });
        return ev;
    };

    beforeEach(() => {
        jest.useFakeTimers({ now: NOW });
        stubClient();
        client = MatrixClientPeg.safeGet();
        room = new Room(ROOM_ID, client, client.getSafeUserId(), {
            pendingEventOrdering: PendingEventOrdering.Detached,
        });
        jest.spyOn(client, "getRoom").mockReturnValue(room);
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it("parses timers; empty objects mean disabled", () => {
        expect(parseDisappearingTimer({ type: "after_send", timer: 60000 })).toEqual({
            type: "after_send",
            timer: 60000,
        });
        expect(parseDisappearingTimer({})).toBeUndefined();
        expect(parseDisappearingTimer({ type: "after_send", timer: 0 })).toBeUndefined();
        expect(parseDisappearingTimer({ type: "bogus", timer: 5 })).toBeUndefined();
        expect(formatDisappearingDuration(30_000)).toBe("30s");
        expect(formatDisappearingDuration(3_600_000)).toBe("1h");
        expect(formatDisappearingDuration(7 * 86_400_000)).toBe("1w");
    });

    it("after_send expires relative to the send time and is hidden from the timeline", () => {
        const ev = mkMsg({ type: "after_send", timer: 60_000 }, { ts: NOW - 30_000 });
        expect(getDisappearingExpiry(ev, room, client.getSafeUserId())).toBe(NOW + 30_000);
        expect(shouldHideEvent(ev)).toBe(false);
        jest.setSystemTime(NOW + 30_001);
        expect(shouldHideEvent(ev)).toBe(true);
    });

    it("after_read on an incoming message only starts once we have read it", () => {
        const ev = mkMsg({ type: "after_read", timer: 60_000 });
        const me = client.getSafeUserId();
        expect(getDisappearingExpiry(ev, room, me)).toBeUndefined();

        room.addReceipt(
            new MatrixEvent({
                type: "m.receipt",
                room_id: ROOM_ID,
                content: { [ev.getId()!]: { [ReceiptType.Read]: { [me]: { ts: NOW + 5000 } } } },
            }),
        );
        expect(getDisappearingExpiry(ev, room, me)).toBe(NOW + 65_000);
    });

    it("badge counts down and tells the tile when the message disappears", () => {
        const ev = mkMsg({ type: "after_send", timer: 90_000 });
        const onDisappeared = jest.fn();
        render(
            <MatrixClientContext.Provider value={client}>
                <DisappearingMessageBadge mxEvent={ev} onDisappeared={onDisappeared} />
            </MatrixClientContext.Provider>,
        );
        // Each tick re-arms the next timeout from an effect, so advance one tick per act().
        const advance = (ms: number): void => {
            for (let t = 0; t < ms; t += 1000) act(() => jest.advanceTimersByTime(1000));
        };
        expect(screen.getByLabelText("Disappears in 2m")).toBeInTheDocument();
        advance(60_000);
        expect(screen.getByLabelText("Disappears in 30s")).toBeInTheDocument();
        expect(onDisappeared).not.toHaveBeenCalled();
        advance(31_000);
        expect(onDisappeared).toHaveBeenCalled();
    });

    it("badge shows the configured duration before an after_read timer starts", () => {
        const ev = mkMsg({ type: "after_read", timer: 86_400_000 });
        render(
            <MatrixClientContext.Provider value={client}>
                <DisappearingMessageBadge mxEvent={ev} />
            </MatrixClientContext.Provider>,
        );
        expect(screen.getByLabelText("Disappears 1d after it's read")).toBeInTheDocument();
    });

    it("renders nothing on normal messages", () => {
        const ev = mkMsg(undefined);
        const { container } = render(
            <MatrixClientContext.Provider value={client}>
                <DisappearingMessageBadge mxEvent={ev} />
            </MatrixClientContext.Provider>,
        );
        expect(container).toBeEmptyDOMElement();
        expect(shouldHideEvent(ev)).toBe(false);
    });

    it("room header shows the room's timer from state", () => {
        const { container, rerender } = render(<DisappearingTimerHeaderBadge room={room} />);
        expect(container).toBeEmptyDOMElement();

        act(() => {
            room.currentState.setStateEvents([
                mkEvent({
                    event: true,
                    type: DISAPPEARING_TIMER_KEY,
                    skey: "",
                    room: ROOM_ID,
                    user: "@signalbot:example.org",
                    content: { type: "after_read", timer: 28_800_000 },
                }),
            ]);
        });
        rerender(<DisappearingTimerHeaderBadge room={room} />);
        expect(screen.getByLabelText("Disappearing messages: 8h after they're read")).toBeInTheDocument();
    });
});
