/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, vi } from "vitest";
import { Room, type RoomState } from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";
import { mkEvent, mkMessage, mkRoom, stubClient } from "test-utils";

import { getLastTimestamp } from "./getLastTimestamp";

describe("getLastTimestamp", () => {
    it("should return last timestamp", () => {
        const cli = stubClient();
        const room = new Room("room123", cli, "@john:matrix.org");

        const event1 = mkMessage({
            room: room.roomId,
            msg: "Hello world!",
            user: "@alice:matrix.org",
            ts: 5,
            event: true,
        });
        const event2 = mkMessage({
            room: room.roomId,
            msg: "Howdy!",
            user: "@bob:matrix.org",
            ts: 10,
            event: true,
        });

        room.getMyMembership = () => KnownMembership.Join;

        room.addLiveEvents([event1], { addToState: true });
        expect(getLastTimestamp(room, "@jane:matrix.org")).toBe(5);
        expect(getLastTimestamp(room, "@john:matrix.org")).toBe(5);

        room.addLiveEvents([event2], { addToState: true });

        expect(getLastTimestamp(room, "@jane:matrix.org")).toBe(10);
        expect(getLastTimestamp(room, "@john:matrix.org")).toBe(10);
    });

    it("should return timestamp of membership event if user not joined to room", () => {
        const cli = stubClient();
        const room = mkRoom(cli, "!new:example.org");
        // Mock a membership event
        vi.spyOn(room.getLiveTimeline(), "getState").mockImplementation((_) => {
            return {
                getStateEvents: () =>
                    mkEvent({
                        type: "m.room.member",
                        user: "@john:matrix.org",
                        content: {},
                        ts: 500,
                        event: true,
                    }),
            } as unknown as RoomState;
        });
        vi.spyOn(room, "getMyMembership").mockReturnValue(KnownMembership.Invite);
        expect(getLastTimestamp(room, "@john:matrix.org")).toBe(500);
    });

    it("should return bump stamp when using sliding sync", () => {
        const cli = stubClient();
        const room = new Room("room123", cli, "@john:matrix.org");

        const event1 = mkMessage({
            room: room.roomId,
            msg: "Hello world!",
            user: "@alice:matrix.org",
            ts: 5,
            event: true,
        });
        const event2 = mkMessage({
            room: room.roomId,
            msg: "Howdy!",
            user: "@bob:matrix.org",
            ts: 10,
            event: true,
        });

        vi.spyOn(room, "getMyMembership").mockReturnValue(KnownMembership.Join);
        vi.spyOn(room, "getBumpStamp").mockReturnValue(314);
        room.addLiveEvents([event1, event2], { addToState: true });
        expect(getLastTimestamp(room, "@john:matrix.org")).toBe(314);
    });

    /*
     * A bridge renaming the ghosts in a group sends a member event per ghost. When a limited sync (or the
     * trimmed replay at startup) leaves only those in memory, the room's last message is older than all of
     * them, so none of them can stand in for it.
     */
    describe("when nothing loaded counts as activity", () => {
        const rename = (ts: number, user: string) =>
            mkEvent({
                type: "m.room.member",
                user,
                skey: user,
                content: { membership: "join", displayname: "new" },
                prev_content: { membership: "join", displayname: "old" },
                ts,
                event: true,
            });

        it("should use the activity seen before the timeline was reset", () => {
            const cli = stubClient();
            const room = new Room("!group:example.org", cli, "@john:matrix.org");
            vi.spyOn(room, "getMyMembership").mockReturnValue(KnownMembership.Join);
            const message = mkMessage({
                room: room.roomId,
                msg: "hi",
                user: "@alice:matrix.org",
                ts: 100,
                event: true,
            });
            room.addLiveEvents([message], { addToState: true });
            expect(getLastTimestamp(room, "@john:matrix.org")).toBe(100);

            room.resetLiveTimeline("back_token");
            room.addLiveEvents([rename(9000, "@ghost1:example.org"), rename(9001, "@ghost2:example.org")], {
                addToState: true,
            });

            expect(getLastTimestamp(room, "@john:matrix.org")).toBe(100);
        });

        it("should sort last when there is older history and no activity was ever seen", () => {
            const cli = stubClient();
            const room = new Room("!quiet:example.org", cli, "@john:matrix.org");
            vi.spyOn(room, "getMyMembership").mockReturnValue(KnownMembership.Join);
            room.resetLiveTimeline("back_token");
            room.addLiveEvents([rename(9000, "@ghost1:example.org")], { addToState: true });

            expect(getLastTimestamp(room, "@john:matrix.org")).toBe(0);
        });

        it("should use the oldest event when the whole room is loaded", () => {
            const cli = stubClient();
            const room = new Room("!new:example.org", cli, "@john:matrix.org");
            vi.spyOn(room, "getMyMembership").mockReturnValue(KnownMembership.Join);
            room.addLiveEvents([rename(700, "@ghost1:example.org"), rename(800, "@ghost2:example.org")], {
                addToState: true,
            });

            expect(getLastTimestamp(room, "@john:matrix.org")).toBe(700);
        });
    });

    /* Only somebody saying something moves a room; everything a bridge does in the background must not. */
    describe("what counts as activity", () => {
        const setup = () => {
            const cli = stubClient();
            const room = new Room("!chat:example.org", cli, "@john:matrix.org");
            vi.spyOn(room, "getMyMembership").mockReturnValue(KnownMembership.Join);
            return room;
        };
        const message = (room: Room, ts: number, content: Record<string, unknown> = {}) =>
            mkEvent({
                type: "m.room.message",
                room: room.roomId,
                user: "@alice:matrix.org",
                content: { msgtype: "m.text", body: "hi", ...content },
                ts,
                event: true,
            });

        it("should not move a room down when older messages are backfilled after newer ones", () => {
            const room = setup();
            room.addLiveEvents([message(room, 5000), message(room, 100), message(room, 200)], { addToState: true });
            expect(getLastTimestamp(room, "@john:matrix.org")).toBe(5000);
        });

        it("should not move a room back down after the timeline is reset to older events", () => {
            const room = setup();
            room.addLiveEvents([message(room, 5000)], { addToState: true });
            expect(getLastTimestamp(room, "@john:matrix.org")).toBe(5000);
            room.resetLiveTimeline("back_token");
            room.addLiveEvents([message(room, 100)], { addToState: true });
            expect(getLastTimestamp(room, "@john:matrix.org")).toBe(5000);
        });

        it("should ignore a room name change", () => {
            const room = setup();
            const name = mkEvent({
                type: "m.room.name",
                room: room.roomId,
                user: "@bridge:example.org",
                skey: "",
                content: { name: "New name" },
                ts: 9000,
                event: true,
            });
            room.addLiveEvents([message(room, 100), name], { addToState: true });
            expect(getLastTimestamp(room, "@john:matrix.org")).toBe(100);
        });

        it("should ignore notices", () => {
            const room = setup();
            room.addLiveEvents([message(room, 100), message(room, 9000, { msgtype: "m.notice" })], {
                addToState: true,
            });
            expect(getLastTimestamp(room, "@john:matrix.org")).toBe(100);
        });

        /*
         * A bridge made a portal today for a chat whose whole history is one system notice from months
         * ago. The join was the only thing left to sort by, so the chat sat above ones written in today.
         */
        it("should sort a room with nothing but a notice by the notice, not by the reader being joined to it", () => {
            const cli = stubClient();
            const room = new Room("!portal:example.org", cli, "@john:matrix.org");
            vi.spyOn(room, "getMyMembership").mockReturnValue(KnownMembership.Join);
            const join = mkEvent({
                type: "m.room.member",
                room: room.roomId,
                user: "@john:matrix.org",
                skey: "@john:matrix.org",
                content: { membership: "join" },
                prev_content: { membership: "invite" },
                ts: 9000,
                event: true,
            });
            room.addLiveEvents([message(room, 100, { msgtype: "m.notice" }), join], { addToState: true });

            expect(getLastTimestamp(room, "@john:matrix.org")).toBe(100);
        });

        it("should still not let a notice move a room that people have written in", () => {
            const room = new Room("!busy:example.org", stubClient(), "@john:matrix.org");
            vi.spyOn(room, "getMyMembership").mockReturnValue(KnownMembership.Join);
            room.addLiveEvents([message(room, 500), message(room, 9000, { msgtype: "m.notice" })], {
                addToState: true,
            });
            expect(getLastTimestamp(room, "@john:matrix.org")).toBe(500);
        });

        it("should ignore edits", () => {
            const room = setup();
            const edit = message(room, 9000, {
                "m.new_content": { msgtype: "m.text", body: "edited" },
                "m.relates_to": { rel_type: "m.replace", event_id: "$original" },
            });
            room.addLiveEvents([message(room, 100), edit], { addToState: true });
            expect(getLastTimestamp(room, "@john:matrix.org")).toBe(100);
        });

        it("should count the reader's own messages", () => {
            const room = setup();
            const own = mkMessage({ room: room.roomId, msg: "mine", user: "@john:matrix.org", ts: 700, event: true });
            room.addLiveEvents([message(room, 100), own], { addToState: true });
            expect(getLastTimestamp(room, "@john:matrix.org")).toBe(700);
        });
    });

    describe("membership event special cases", () => {
        it("should consider event if membership has changed", () => {
            const cli = stubClient();
            const room = new Room("room123", cli, "@john:matrix.org");

            const event1 = mkMessage({
                room: room.roomId,
                msg: "Hello world!",
                user: "@alice:matrix.org",
                ts: 5,
                event: true,
            });
            // Display name change that should be ignored during timestamp calculation
            const event2 = mkEvent({
                type: "m.room.member",
                user: "@john:matrix.org",
                content: {
                    membership: "leave",
                },
                prev_content: {
                    membership: "join",
                },
                ts: 400,
                event: true,
            });

            vi.spyOn(room, "getMyMembership").mockReturnValue(KnownMembership.Join);
            room.addLiveEvents([event1, event2], { addToState: true });

            // Fork: the reader's own membership only counts in a room with no messages loaded - a bridge
            // joining the reader to a portal for an old chat is not activity in that chat.
            expect(getLastTimestamp(room, "@john:matrix.org")).toBe(5);
        });

        it("should consider the reader's own membership change in a room with no messages", () => {
            const cli = stubClient();
            const room = new Room("room123", cli, "@john:matrix.org");
            const join = mkEvent({
                type: "m.room.member",
                user: "@john:matrix.org",
                skey: "@john:matrix.org",
                content: { membership: "join" },
                prev_content: { membership: "invite" },
                ts: 400,
                event: true,
            });
            vi.spyOn(room, "getMyMembership").mockReturnValue(KnownMembership.Join);
            room.addLiveEvents([join], { addToState: true });

            expect(getLastTimestamp(room, "@john:matrix.org")).toBe(400);
        });

        it("should skip display name changes", () => {
            const cli = stubClient();
            const room = new Room("room123", cli, "@john:matrix.org");

            const event1 = mkMessage({
                room: room.roomId,
                msg: "Hello world!",
                user: "@alice:matrix.org",
                ts: 5,
                event: true,
            });
            // Display name change that should be ignored during timestamp calculation
            const event2 = mkEvent({
                type: "m.room.member",
                user: "@john:matrix.org",
                content: {
                    displayname: "bar",
                },
                prev_content: {
                    displayname: "foo",
                },
                ts: 500,
                event: true,
            });

            vi.spyOn(room, "getMyMembership").mockReturnValue(KnownMembership.Join);
            room.addLiveEvents([event1, event2], { addToState: true });

            expect(getLastTimestamp(room, "@john:matrix.org")).toBe(5);
        });

        it("should skip avatar changes", () => {
            const cli = stubClient();
            const room = new Room("room123", cli, "@john:matrix.org");

            const event1 = mkMessage({
                room: room.roomId,
                msg: "Hello world!",
                user: "@alice:matrix.org",
                ts: 5,
                event: true,
            });
            // Avatar url change that should be ignored during timestamp calculation
            const event2 = mkEvent({
                type: "m.room.member",
                user: "@john:matrix.org",
                content: {
                    avatar_url: "bar",
                },
                prev_content: {
                    avatar_url: "foo",
                },
                ts: 500,
                event: true,
            });

            vi.spyOn(room, "getMyMembership").mockReturnValue(KnownMembership.Join);
            room.addLiveEvents([event1, event2], { addToState: true });

            expect(getLastTimestamp(room, "@john:matrix.org")).toBe(5);
        });
    });
});
