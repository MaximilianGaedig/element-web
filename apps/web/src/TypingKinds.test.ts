/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    ClientEvent,
    type MatrixClient,
    MatrixEvent,
    type Room,
    type RoomMember,
    RoomMemberEvent,
    TypedEventEmitter,
} from "matrix-js-sdk/src/matrix";

import {
    onTypingKindsChanged,
    parseTypingKind,
    typingKindOf,
    typingKindsOf,
    uploadTypingKind,
    watchTypingKinds,
} from "./TypingKinds";

const ADA = "@ada:example.org";
const GRACE = "@grace:example.org";

describe("typing kinds", () => {
    describe("reading them", () => {
        it("knows the vocabulary and takes anything else for plain typing", () => {
            for (const kind of [
                "recording_voice",
                "recording_video",
                "uploading_photo",
                "uploading_video",
                "uploading_file",
                "uploading_voice",
                "choosing_sticker",
            ]) {
                expect(parseTypingKind(kind)).toBe(kind);
            }
            for (const unknown of ["text", "playing_a_game", "Recording_Voice", "", undefined, null, 7, {}, []]) {
                expect(parseTypingKind(unknown)).toBe("text");
            }
        });

        it("lists only typing users who are not typing text", () => {
            const kinds = typingKindsOf({
                "user_ids": [ADA, GRACE],
                "im.mxg.typing.kinds": { [ADA]: "recording_voice", "@gone:example.org": "uploading_photo" },
            });
            expect([...kinds]).toEqual([[ADA, "recording_voice"]]);
        });

        it("reads an event without kinds, or with malformed ones, as plain typing", () => {
            expect(typingKindsOf({ user_ids: [ADA] }).size).toBe(0);
            expect(typingKindsOf({ "user_ids": [ADA], "im.mxg.typing.kinds": { [ADA]: "playing_a_game" } }).size).toBe(
                0,
            );
            expect(typingKindsOf({ "user_ids": [ADA], "im.mxg.typing.kinds": { [ADA]: 3 } }).size).toBe(0);
            expect(typingKindsOf({ "user_ids": [ADA], "im.mxg.typing.kinds": "recording_voice" }).size).toBe(0);
            expect(typingKindsOf({ "user_ids": [ADA], "im.mxg.typing.kinds": [ADA] }).size).toBe(0);
            expect(
                typingKindsOf({ "user_ids": "nobody", "im.mxg.typing.kinds": { [ADA]: "recording_voice" } }).size,
            ).toBe(0);
            // A user ID that happens to name something every object has is not a kind either.
            expect(typingKindsOf({ "user_ids": ["toString"], "im.mxg.typing.kinds": {} }).size).toBe(0);
            expect(typingKindsOf(undefined).size).toBe(0);
        });

        it("names an upload by what is uploaded", () => {
            expect(uploadTypingKind("image/jpeg")).toBe("uploading_photo");
            expect(uploadTypingKind("video/mp4")).toBe("uploading_video");
            expect(uploadTypingKind("audio/ogg")).toBe("uploading_voice");
            expect(uploadTypingKind("application/pdf")).toBe("uploading_file");
            expect(uploadTypingKind("")).toBe("uploading_file");
            expect(uploadTypingKind(undefined)).toBe("uploading_file");
        });
    });

    describe("following a client", () => {
        let client: MatrixClient;
        let rooms: Map<string, Room>;
        let changed: ReturnType<typeof vi.fn<(roomId: string) => void>>;

        // A room that knows the given members, each of which the SDK would mark as typing or not.
        const mkRoom = (roomId: string, userIds: string[]): Room => {
            const members = new Map(userIds.map((userId) => [userId, { userId, roomId, typing: false } as RoomMember]));
            const room = { roomId, client, getMember: (userId: string) => members.get(userId) ?? null } as Room;
            rooms.set(roomId, room);
            return room;
        };

        // What the SDK does with a typing event from /sync, which has no room ID: members whose typing
        // changed are emitted with it, and then the event itself is.
        const receive = (room: Room, userIds: string[], kinds?: Record<string, unknown>): void => {
            const content = kinds ? { "user_ids": userIds, "im.mxg.typing.kinds": kinds } : { user_ids: userIds };
            const event = new MatrixEvent({ type: "m.typing", content });
            for (const userId of [...userIds, ADA, GRACE]) {
                const member = room.getMember(userId);
                const typing = userIds.includes(userId);
                if (!member || member.typing === typing) continue;
                member.typing = typing;
                client.emit(RoomMemberEvent.Typing, event, member);
            }
            client.emit(ClientEvent.Event, event);
        };

        beforeEach(() => {
            rooms = new Map();
            client = Object.assign(new TypedEventEmitter(), {
                getRoom: (roomId: string) => rooms.get(roomId) ?? null,
            }) as unknown as MatrixClient;
            watchTypingKinds(client);
            changed = vi.fn<(roomId: string) => void>();
        });

        it("knows what somebody who starts is doing, and forgets it when they stop", () => {
            const room = mkRoom("!a:example.org", [ADA, GRACE]);
            const stop = onTypingKindsChanged(changed);

            receive(room, [ADA, GRACE], { [ADA]: "recording_voice" });
            expect(typingKindOf(room, ADA)).toBe("recording_voice");
            expect(typingKindOf(room, GRACE)).toBe("text");
            expect(changed).toHaveBeenCalledExactlyOnceWith(room.roomId);

            receive(room, [GRACE]);
            expect(typingKindOf(room, ADA)).toBe("text");
            expect(changed).toHaveBeenCalledTimes(2);
            stop();
        });

        it("follows somebody from typing to recording, though nobody started or stopped", () => {
            const room = mkRoom("!a:example.org", [ADA, GRACE]);
            const other = mkRoom("!b:example.org", [ADA, GRACE]);
            receive(room, [ADA]);
            receive(other, [GRACE]);
            const stop = onTypingKindsChanged(changed);

            receive(room, [ADA], { [ADA]: "recording_voice" });
            expect(typingKindOf(room, ADA)).toBe("recording_voice");
            expect(typingKindOf(other, ADA)).toBe("text");
            expect(changed).toHaveBeenCalledExactlyOnceWith(room.roomId);

            // The same thing again is not a change.
            receive(room, [ADA], { [ADA]: "recording_voice" });
            expect(changed).toHaveBeenCalledTimes(1);

            receive(room, [ADA]);
            expect(typingKindOf(room, ADA)).toBe("text");
            expect(changed).toHaveBeenCalledTimes(2);
            stop();
        });

        it("matches a room whose other typing users are not loaded as members", () => {
            const room = mkRoom("!a:example.org", [ADA]);
            receive(room, [ADA, "@stranger:example.org"]);
            receive(room, [ADA, "@stranger:example.org"], { [ADA]: "uploading_photo" });
            expect(typingKindOf(room, ADA)).toBe("uploading_photo");
        });

        it("leaves the kinds alone when the same people type in two rooms and it cannot tell which", () => {
            const room = mkRoom("!a:example.org", [ADA]);
            const other = mkRoom("!b:example.org", [ADA]);
            receive(room, [ADA]);
            receive(other, [ADA]);

            receive(room, [ADA], { [ADA]: "recording_voice" });
            expect(typingKindOf(room, ADA)).toBe("text");
            expect(typingKindOf(other, ADA)).toBe("text");
        });

        it("takes the room from the event when it has one", () => {
            const room = mkRoom("!a:example.org", [ADA]);
            const other = mkRoom("!b:example.org", [ADA]);
            receive(room, [ADA]);
            receive(other, [ADA]);

            client.emit(
                ClientEvent.Event,
                new MatrixEvent({
                    type: "m.typing",
                    room_id: other.roomId,
                    content: { "user_ids": [ADA], "im.mxg.typing.kinds": { [ADA]: "choosing_sticker" } },
                }),
            );
            expect(typingKindOf(room, ADA)).toBe("text");
            expect(typingKindOf(other, ADA)).toBe("choosing_sticker");
        });

        it("is typing text for a client nobody watches", () => {
            const room = { roomId: "!a:example.org", client: new TypedEventEmitter() } as unknown as Room;
            expect(typingKindOf(room, ADA)).toBe("text");
        });
    });
});
