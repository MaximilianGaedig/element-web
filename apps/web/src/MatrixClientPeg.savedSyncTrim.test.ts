/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect } from "vitest";
import { EventType, MatrixEvent, Room, SyncAccumulator, type ISyncResponse } from "matrix-js-sdk/src/matrix";
import { stubClient } from "test-utils";

import { ROOM_LIST_STATE_TYPES } from "./MatrixClientPeg";

const ROOM_ID = "!dm:example.org";
const ME = "@me:example.org";
const CONTACT = "@facebook_1:example.org";
const MY_GHOST = "@facebook_2:example.org";
const BOT = "@facebookbot:example.org";

let counter = 0;
function event(type: string, sender: string, content: object, stateKey?: string): any {
    counter++;
    return {
        type,
        sender,
        content,
        event_id: `$event${counter}`,
        origin_server_ts: counter,
        ...(stateKey === undefined ? {} : { state_key: stateKey }),
    };
}

const member = (userId: string, avatar?: string): any =>
    event(EventType.RoomMember, userId, { membership: "join", displayname: userId, avatar_url: avatar }, userId);

/** A bridged chat with one person, as the bridge leaves it after you have sent a message in it. */
function bridgedDmSync(): ISyncResponse {
    return {
        next_batch: "s1",
        account_data: { events: [{ type: EventType.Direct, content: { [CONTACT]: [ROOM_ID] } }] },
        rooms: {
            join: {
                [ROOM_ID]: {
                    summary: { "m.heroes": [CONTACT], "m.joined_member_count": 4, "m.invited_member_count": 0 },
                    state: {
                        events: [
                            event(EventType.RoomCreate, BOT, { room_version: "11" }, ""),
                            member(BOT, "mxc://example.org/bot"),
                            member(MY_GHOST, "mxc://example.org/mine"),
                            member(CONTACT, "mxc://example.org/contact"),
                            member(ME),
                            event("io.element.functional_members", BOT, { service_members: [BOT, MY_GHOST] }, ""),
                        ],
                    },
                    timeline: {
                        events: [
                            event(EventType.RoomMessage, CONTACT, { msgtype: "m.text", body: "earlier" }),
                            event(EventType.RoomMessage, ME, { msgtype: "m.text", body: "hello" }),
                            // what a bridge sends after each of your messages: sent, then delivered
                            event("com.beeper.message_send_status", BOT, { status: "SUCCESS" }),
                            event("com.beeper.message_send_status", BOT, { status: "SUCCESS" }),
                        ],
                        prev_batch: "p1",
                    },
                    ephemeral: { events: [] },
                    account_data: { events: [] },
                    unread_notifications: {},
                },
            },
            invite: {},
            leave: {},
            knock: {},
        },
    } as unknown as ISyncResponse;
}

describe("the state a trimmed room keeps at startup", () => {
    it("still knows who in a bridged chat is not a person, so the chat takes the other person's picture", () => {
        const accumulator = new SyncAccumulator();
        accumulator.accumulate(bridgedDmSync());
        const replayed = accumulator.getJSON(false, { tail: 3, listStateTypes: ROOM_LIST_STATE_TYPES, userId: ME });
        const state = replayed.roomsData.join[ROOM_ID]["org.matrix.msc4222.state_after"]!.events;

        // The trim did happen, and kept the bot as the sender of the room's last events
        expect(state.some((ev) => ev.type === EventType.RoomMember && ev.state_key === MY_GHOST)).toBe(false);
        expect(state.some((ev) => ev.type === EventType.RoomMember && ev.state_key === BOT)).toBe(true);

        const room = new Room(ROOM_ID, stubClient(), ME);
        room.currentState.setStateEvents(state.map((ev) => new MatrixEvent({ ...ev, room_id: ROOM_ID })));

        expect(room.getAvatarFallbackMember()?.userId).toBe(CONTACT);
        expect(room.getAvatarFallbackMember()?.getMxcAvatarUrl()).toBe("mxc://example.org/contact");
    });
});
