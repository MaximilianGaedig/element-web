/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React from "react";
import { act, render, screen } from "jest-matrix-react";
import { type MatrixClient, MatrixEvent, PendingEventOrdering, Room, User } from "matrix-js-sdk/src/matrix";

import { MatrixClientPeg } from "../../../../../src/MatrixClientPeg";
import MatrixClientContext from "../../../../../src/contexts/MatrixClientContext";
import DMRoomMap from "../../../../../src/utils/DMRoomMap";
import { mkEvent, mkMembership, stubClient } from "../../../../test-utils";
import { formatLastSeen } from "../../../../../src/utils/beeper/lastSeen";
import { getBridgedDmUserId } from "../../../../../src/utils/beeper/bridgeInfo";
import {
    BeeperDmLastSeenSubtitle,
    BeeperLastSeenLabel,
} from "../../../../../src/components/views/beeper/BeeperLastSeen";

// Fri 18 Sep 2026, 21:45:00 in Berlin (UTC+2).
const NOW = Date.parse("2026-09-18T19:45:00Z");
const OPTS = { now: NOW, locale: "en-GB", timeZone: "Europe/Berlin" };

describe("Telegram-style last seen", () => {
    describe("formatLastSeen", () => {
        it.each([
            ["online", "last seen 2026-09-18T10:00:00Z", "online"],
            ["offline", "last seen 2026-09-18T19:44:40Z", "last seen just now"],
            ["offline", "last seen 2026-09-18T19:44:00Z", "last seen 1 minute ago"],
            ["offline", "last seen 2026-09-18T19:40:00Z", "last seen 5 minutes ago"],
            ["unavailable", "last seen 2026-09-18T08:05:00Z", "last seen today at 10:05"],
            ["offline", "last seen 2026-09-17T19:40:00Z", "last seen yesterday at 21:40"],
            ["offline", "last seen 2026-09-12T19:40:00Z", "last seen 12 Sept at 21:40"],
            ["offline", "last seen 2025-12-24T19:40:00+00:00", "last seen 24 Dec 2025 at 20:40"],
            ["offline", "last seen recently", "last seen recently"],
            ["offline", "last seen within a week", "last seen within a week"],
            ["offline", "last seen within a month", "last seen within a month"],
            ["offline", "last seen long ago", "last seen long ago"],
        ])("%s + %j -> %j", (presence, msg, expected) => {
            expect(formatLastSeen(presence, msg, OPTS)).toBe(expected);
        });

        it("ignores status messages that aren't last-seen info", () => {
            expect(formatLastSeen("offline", "In a meeting", OPTS)).toBeUndefined();
            expect(formatLastSeen("offline", undefined, OPTS)).toBeUndefined();
        });

        it("uses the 12-hour clock when asked", () => {
            expect(formatLastSeen("offline", "last seen 2026-09-18T08:05:00Z", { ...OPTS, showTwelveHour: true })).toBe(
                "last seen today at 10:05 am",
            );
        });
    });

    describe("components", () => {
        let client: MatrixClient;
        let room: Room;
        let ghost: User;
        const ROOM_ID = "!dm:example.org";
        const GHOST = "@telegram_42:example.org";
        const BOT = "@telegrambot:example.org";

        beforeEach(() => {
            jest.useFakeTimers({ now: NOW });
            stubClient();
            client = MatrixClientPeg.safeGet();
            room = new Room(ROOM_ID, client, client.getSafeUserId(), {
                pendingEventOrdering: PendingEventOrdering.Detached,
            });
            jest.spyOn(client, "getRoom").mockReturnValue(room);
            DMRoomMap.makeShared(client);
            jest.spyOn(DMRoomMap.shared(), "getUserIdForRoomId").mockReturnValue(undefined);
            room.currentState.setStateEvents([
                mkEvent({
                    event: true,
                    type: "m.bridge",
                    skey: "telegram",
                    room: ROOM_ID,
                    user: BOT,
                    content: {
                        "bridgebot": BOT,
                        "protocol": { id: "telegram", displayname: "Telegram" },
                        "com.beeper.room_type.v2": "dm",
                    },
                }),
                mkMembership({ event: true, room: ROOM_ID, user: client.getSafeUserId(), mship: "join" }),
                mkMembership({ event: true, room: ROOM_ID, user: BOT, mship: "join" }),
                mkMembership({ event: true, room: ROOM_ID, user: GHOST, mship: "join" }),
            ]);
            ghost = new User(GHOST);
            jest.spyOn(client, "getUser").mockImplementation((id) => (id === GHOST ? ghost : null));
        });

        afterEach(() => {
            jest.useRealTimers();
            jest.restoreAllMocks();
        });

        const setPresence = (presence: string, statusMsg?: string): void => {
            act(() => {
                ghost.setPresenceEvent(
                    new MatrixEvent({
                        type: "m.presence",
                        sender: GHOST,
                        content: { presence, status_msg: statusMsg },
                    }),
                );
            });
        };

        it("treats a bridged DM portal as a DM even without m.direct", () => {
            expect(getBridgedDmUserId(room)).toBe(GHOST);
        });

        it("shows a live last-seen subtitle for a bridged DM", () => {
            setPresence("offline", "last seen 2026-09-18T19:40:00Z");
            render(
                <MatrixClientContext.Provider value={client}>
                    <BeeperDmLastSeenSubtitle room={room} />
                </MatrixClientContext.Provider>,
            );
            expect(screen.getByText("last seen 5 minutes ago")).toBeInTheDocument();

            act(() => jest.advanceTimersByTime(60_000));
            expect(screen.getByText("last seen 6 minutes ago")).toBeInTheDocument();

            setPresence("online");
            expect(screen.getByText("online")).toBeInTheDocument();
        });

        it("user info shows last seen, but keeps Element's label for other status messages", () => {
            setPresence("offline", "last seen within a week");
            const { rerender } = render(<BeeperLastSeenLabel user={ghost} fallback={<span>Offline</span>} />);
            expect(screen.getByText("last seen within a week")).toBeInTheDocument();

            setPresence("offline", "Busy with things");
            rerender(<BeeperLastSeenLabel user={ghost} fallback={<span>Offline</span>} />);
            expect(screen.getByText("Offline")).toBeInTheDocument();
        });
    });
});
