/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { type JSX } from "react";
import { act, render, screen } from "test-utils-rtl";
import {
    type MatrixClient,
    MatrixEvent,
    PendingEventOrdering,
    Room,
    type RoomMember,
    RoomMemberEvent,
    User,
    UserEvent,
} from "matrix-js-sdk/src/matrix";

import { MatrixClientPeg } from "../../../MatrixClientPeg";
import MatrixClientContext from "../../../contexts/MatrixClientContext";
import DMRoomMap from "../../../utils/DMRoomMap";
import WithPresenceIndicator from "../avatars/WithPresenceIndicator";
import { mkEvent, mkMembership, stubClient } from "test-utils";
import { unmockIntlDateTimeFormat } from "test-utils/date";
import { formatPresence } from "../../../utils/presence/lastSeen";
import { type PresenceInfo } from "../../../utils/presence/activity";
import { getBridgedDmUserId } from "../../../utils/bridge/bridgeInfo";
import { DmLastSeenSubtitle, LastSeenLabel } from "./LastSeen";
import { TypingSubtitle, typingText } from "./TypingSubtitle";

// Fri 18 Sep 2026, 21:45:00 in Berlin (UTC+2).
const NOW = Date.parse("2026-09-18T19:45:00Z");
const OPTS = { now: NOW, locale: "en-GB", timeZone: "Europe/Berlin" };
const seen = (lastActive: number, online = false): PresenceInfo => ({
    online,
    lastActive,
    minutes: Math.floor((NOW - lastActive) / 60_000),
});

describe("Telegram-style last seen", () => {
    describe("formatPresence", () => {
        // These cases pass an explicit time zone; the global test setup forces every formatter to UTC.
        beforeEach(() => unmockIntlDateTimeFormat());

        it.each([
            ["2026-09-18T19:44:40Z", "last seen just now"],
            ["2026-09-18T19:44:00Z", "last seen 1 minute ago"],
            ["2026-09-18T19:40:00Z", "last seen 5 minutes ago"],
            ["2026-09-18T08:05:00Z", "last seen today at 10:05"],
            ["2026-09-17T19:40:00Z", "last seen yesterday at 21:40"],
            ["2026-09-12T19:40:00Z", "last seen 12 Sept at 21:40"],
            ["2025-12-24T19:40:00+00:00", "last seen 24 Dec 2025 at 20:40"],
        ])("last active %s -> %j", (at, expected) => {
            expect(formatPresence(seen(Date.parse(at)), OPTS)).toBe(expected);
        });

        it("says online, and nothing without a last-active time", () => {
            expect(formatPresence(seen(Date.parse("2026-09-18T10:00:00Z"), true), OPTS)).toBe("online");
            expect(formatPresence({ online: false }, OPTS)).toBeUndefined();
        });

        it("uses the 12-hour clock when asked", () => {
            expect(formatPresence(seen(Date.parse("2026-09-18T08:05:00Z")), { ...OPTS, showTwelveHour: true })).toBe(
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
            vi.useFakeTimers({ now: NOW });
            stubClient();
            client = MatrixClientPeg.safeGet();
            room = new Room(ROOM_ID, client, client.getSafeUserId(), {
                pendingEventOrdering: PendingEventOrdering.Detached,
            });
            vi.spyOn(client, "getRoom").mockReturnValue(room);
            DMRoomMap.makeShared(client);
            vi.spyOn(DMRoomMap.shared(), "getUserIdForRoomId").mockReturnValue(undefined);
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
            // Like User.createUser(): re-emit the user's events on the client.
            for (const ev of [UserEvent.Presence, UserEvent.LastPresenceTs]) {
                ghost.on(ev, (...args: any[]) => client.emit(ev as any, ...(args as [any, any])));
            }
            vi.spyOn(client, "getUser").mockImplementation((id) => (id === GHOST ? ghost : null));
        });

        afterEach(() => {
            vi.useRealTimers();
            vi.restoreAllMocks();
        });

        const setPresence = (presence: string, lastActiveAgo?: number): void => {
            act(() => {
                ghost.setPresenceEvent(
                    new MatrixEvent({
                        type: "m.presence",
                        sender: GHOST,
                        origin_server_ts: Date.now(),
                        content: { presence, last_active_ago: lastActiveAgo },
                    }),
                );
            });
        };

        it("shows the presence dot for an m.direct DM whose member list isn't loaded (sliding sync)", () => {
            const lazyRoom = new Room("!lazy:example.org", client, client.getSafeUserId(), {
                pendingEventOrdering: PendingEventOrdering.Detached,
            });
            vi.spyOn(DMRoomMap.shared(), "getUserIdForRoomId").mockReturnValue(GHOST);
            // Active two minutes ago: the recently-active tag and a "last seen" show.
            setPresence("offline", 2 * 60 * 1000);
            const { container } = render(
                <MatrixClientContext.Provider value={client}>
                    <WithPresenceIndicator room={lazyRoom}>
                        <span />
                    </WithPresenceIndicator>
                    <DmLastSeenSubtitle room={lazyRoom} />
                </MatrixClientContext.Provider>,
            );
            expect(container.querySelector(".mx_ActivityDot")).toBeInTheDocument();
            expect(screen.getByText(/last seen/)).toBeInTheDocument();
        });

        it("treats a bridged DM portal as a DM even without m.direct", () => {
            expect(getBridgedDmUserId(room)).toBe(GHOST);
        });

        it("shows a live last-seen subtitle for a bridged DM", () => {
            setPresence("offline", 5 * 60 * 1000);
            render(
                <MatrixClientContext.Provider value={client}>
                    <DmLastSeenSubtitle room={room} />
                </MatrixClientContext.Provider>,
            );
            expect(screen.getByText("last seen 5 minutes ago")).toBeInTheDocument();

            act(() => vi.advanceTimersByTime(60_000));
            expect(screen.getByText("last seen 6 minutes ago")).toBeInTheDocument();

            setPresence("online");
            expect(screen.getByText("online")).toBeInTheDocument();
        });

        const setTyping = (member: RoomMember, typing: boolean): void => {
            act(() => {
                member.typing = typing;
                client.emit(RoomMemberEvent.Typing, new MatrixEvent({ type: "m.typing" }), member);
            });
        };

        it("replaces the DM subtitle with an animated 'typing' while the other side types", () => {
            setPresence("online");
            const { container } = render(
                <MatrixClientContext.Provider value={client}>
                    <DmLastSeenSubtitle room={room} />
                </MatrixClientContext.Provider>,
            );
            expect(screen.getByText("online")).toBeInTheDocument();

            setTyping(room.getMember(GHOST)!, true);
            expect(screen.getByText("typing")).toBeInTheDocument();
            expect(screen.queryByText("online")).not.toBeInTheDocument();
            expect(container.querySelectorAll(".mx_TypingIndicator_dot")).toHaveLength(3);

            setTyping(room.getMember(GHOST)!, false);
            expect(screen.getByText("online")).toBeInTheDocument();
        });

        it("ignores our own typing", () => {
            setPresence("online");
            render(
                <MatrixClientContext.Provider value={client}>
                    <DmLastSeenSubtitle room={room} />
                </MatrixClientContext.Provider>,
            );
            setTyping(room.getMember(client.getSafeUserId())!, true);
            expect(screen.getByText("online")).toBeInTheDocument();
        });

        it("shows who is typing in a group header", () => {
            render(
                <MatrixClientContext.Provider value={client}>
                    <TypingSubtitle room={room} isDm={false} />
                </MatrixClientContext.Provider>,
            );
            expect(screen.queryByText(/typing/)).not.toBeInTheDocument();
            const ghostMember = room.getMember(GHOST)!;
            ghostMember.rawDisplayName = "Alice Smith";
            setTyping(ghostMember, true);
            expect(screen.getByText("Alice is typing")).toBeInTheDocument();
        });

        it("formats group typing like Telegram", () => {
            const m = (name: string): RoomMember => ({ rawDisplayName: name, name, userId: name }) as RoomMember;
            expect(typingText([], false)).toBeUndefined();
            expect(typingText([m("Alice Smith")], true)).toBe("typing");
            expect(typingText([m("Alice Smith")], false)).toBe("Alice is typing");
            expect(typingText([m("Alice"), m("Bob")], false)).toBe("Alice and Bob are typing");
            expect(typingText([m("Alice"), m("Bob"), m("Carol"), m("Dan")], false)).toBe(
                "Alice and 3 others are typing",
            );
        });

        it("user info shows last seen, but keeps Element's label without a last-active time", () => {
            setPresence("offline", 5 * 60 * 1000);
            const renderLabel = (): JSX.Element => (
                <MatrixClientContext.Provider value={client}>
                    <LastSeenLabel userId={GHOST} fallback={<span>Offline</span>} />
                </MatrixClientContext.Provider>
            );
            const { rerender } = render(renderLabel());
            expect(screen.getByText("last seen 5 minutes ago")).toBeInTheDocument();

            setPresence("offline");
            rerender(renderLabel());
            expect(screen.getByText("Offline")).toBeInTheDocument();
        });
    });
});
