/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { act, render, screen } from "test-utils-rtl";
import {
    ClientEvent,
    type MatrixClient,
    MatrixEvent,
    PendingEventOrdering,
    Room,
    type RoomMember,
    RoomMemberEvent,
} from "matrix-js-sdk/src/matrix";
import { mkMembership, stubClient } from "test-utils";

import { MatrixClientPeg } from "../../../MatrixClientPeg";
import MatrixClientContext from "../../../contexts/MatrixClientContext";
import WhoIsTypingTile from "../rooms/WhoIsTypingTile";
import { TypingSubtitle, typingText } from "./TypingSubtitle";

describe("what a typing user is doing", () => {
    describe("typingText", () => {
        const m = (name: string): RoomMember => ({ rawDisplayName: name, name, userId: name }) as RoomMember;
        const doing =
            (kinds: Record<string, string>) =>
            (member: RoomMember): any =>
                kinds[member.name] ?? "text";

        it.each([
            ["recording_voice", "recording a voice message", "Ada is recording a voice message"],
            ["recording_video", "recording a video", "Ada is recording a video"],
            ["uploading_photo", "sending a photo", "Ada is sending a photo"],
            ["uploading_video", "sending a video", "Ada is sending a video"],
            ["uploading_file", "sending a file", "Ada is sending a file"],
            ["uploading_voice", "sending a voice message", "Ada is sending a voice message"],
            ["choosing_sticker", "choosing a sticker", "Ada is choosing a sticker"],
        ])("says what one person is doing: %s", (kind, inDm, inGroup) => {
            expect(typingText([m("Ada Lovelace")], true, doing({ "Ada Lovelace": kind }))).toBe(inDm);
            expect(typingText([m("Ada Lovelace")], false, doing({ "Ada Lovelace": kind }))).toBe(inGroup);
        });

        it("leaves plain typing as it was", () => {
            expect(typingText([m("Ada")], true, doing({}))).toBe("typing");
            expect(typingText([m("Ada")], false, doing({}))).toBe("Ada is typing");
            expect(typingText([m("Ada")], false)).toBe("Ada is typing");
        });

        it("says several people are typing, whatever each is doing", () => {
            const kindOf = doing({ Ada: "recording_voice", Grace: "uploading_photo" });
            expect(typingText([m("Ada"), m("Grace")], false, kindOf)).toBe("Ada and Grace are typing");
            expect(typingText([m("Ada"), m("Grace"), m("Linus")], false, kindOf)).toBe("Ada and 2 others are typing");
        });
    });

    describe("live", () => {
        let client: MatrixClient;
        let room: Room;
        const ROOM_ID = "!group:example.org";
        const ADA = "@ada:example.org";

        // What the SDK does with a typing event from /sync: members whose typing changed are emitted
        // with it, and then the event itself is, without a room ID.
        const receive = (userIds: string[], kinds?: Record<string, string>): void => {
            const content = kinds ? { "user_ids": userIds, "im.mxg.typing.kinds": kinds } : { user_ids: userIds };
            const event = new MatrixEvent({ type: "m.typing", content });
            act(() => {
                for (const member of room.getMembers()) {
                    const typing = userIds.includes(member.userId);
                    if (member.typing === typing) continue;
                    member.typing = typing;
                    client.emit(RoomMemberEvent.Typing, event, member);
                }
                client.emit(ClientEvent.Event, event);
            });
        };

        beforeEach(() => {
            stubClient();
            client = MatrixClientPeg.safeGet();
            room = new Room(ROOM_ID, client, client.getSafeUserId(), {
                pendingEventOrdering: PendingEventOrdering.Detached,
            });
            vi.spyOn(client, "getRoom").mockReturnValue(room);
            room.currentState.setStateEvents([
                mkMembership({ event: true, room: ROOM_ID, user: client.getSafeUserId(), mship: "join" }),
                mkMembership({ event: true, room: ROOM_ID, user: ADA, mship: "join", name: "Ada Lovelace" }),
            ]);
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it("the room header follows somebody from typing to recording and back", () => {
            render(
                <MatrixClientContext.Provider value={client}>
                    <TypingSubtitle room={room} isDm={false} />
                </MatrixClientContext.Provider>,
            );

            receive([ADA]);
            expect(screen.getByText("Ada is typing")).toBeInTheDocument();

            // Nobody started or stopped typing here: only what Ada is doing changed.
            receive([ADA], { [ADA]: "recording_voice" });
            expect(screen.getByText("Ada is recording a voice message")).toBeInTheDocument();

            receive([ADA]);
            expect(screen.getByText("Ada is typing")).toBeInTheDocument();

            receive([]);
            expect(screen.queryByText(/Ada/)).not.toBeInTheDocument();
        });

        it("a DM's header says it without the name", () => {
            render(
                <MatrixClientContext.Provider value={client}>
                    <TypingSubtitle room={room} isDm={true} />
                </MatrixClientContext.Provider>,
            );
            receive([ADA], { [ADA]: "uploading_photo" });
            expect(screen.getByText("sending a photo")).toBeInTheDocument();
        });

        it("a kind nobody knows shows as typing", () => {
            render(
                <MatrixClientContext.Provider value={client}>
                    <TypingSubtitle room={room} isDm={false} />
                </MatrixClientContext.Provider>,
            );
            receive([ADA], { [ADA]: "playing_a_game" });
            expect(screen.getByText("Ada is typing")).toBeInTheDocument();
        });

        it("the timeline's typing tile says it too, until the message arrives", () => {
            render(<WhoIsTypingTile room={room} />);

            receive([ADA], { [ADA]: "recording_voice" });
            expect(screen.getByText("Ada Lovelace is recording a voice message …")).toBeInTheDocument();

            receive([ADA], { [ADA]: "uploading_voice" });
            expect(screen.getByText("Ada Lovelace is sending a voice message …")).toBeInTheDocument();

            // The tile keeps somebody who stopped for a moment, so that it goes when their message
            // comes in. They are not typing text for that moment.
            receive([]);
            expect(screen.getByText("Ada Lovelace is sending a voice message …")).toBeInTheDocument();
        });
    });
});
