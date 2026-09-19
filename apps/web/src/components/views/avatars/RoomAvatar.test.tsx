/*
Copyright 2024, 2025 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { vi, describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { render } from "test-utils-rtl";
import { EventType, type MatrixClient, MatrixEvent, Room, RoomMember } from "matrix-js-sdk/src/matrix";
import { filterConsole, stubClient } from "test-utils";

import RoomAvatar from "./RoomAvatar";
import DMRoomMap from "../../../utils/DMRoomMap";
import { LocalRoom } from "../../../models/LocalRoom";
import * as AvatarModule from "../../../Avatar";
import { DirectoryMember } from "../../../utils/direct-messages";
import { MediaPreviewValue } from "../../../@types/media_preview";
import SettingsStore from "../../../settings/SettingsStore";
import { SettingLevel } from "../../../settings/SettingLevel";

describe("RoomAvatar", () => {
    let client: MatrixClient;

    filterConsole(
        // unrelated for this test
        "Room !room:example.com does not have an m.room.create event",
    );

    beforeAll(() => {
        client = stubClient();
        const dmRoomMap = new DMRoomMap(client);
        vi.spyOn(dmRoomMap, "getUserIdForRoomId");
        vi.spyOn(DMRoomMap, "shared").mockReturnValue(dmRoomMap);
        vi.spyOn(AvatarModule, "defaultAvatarUrlForString");
    });

    afterAll(() => {
        SettingsStore.setValue(
            "mediaPreviewConfig",
            null,
            SettingLevel.ACCOUNT,
            SettingsStore.getDefaultValue("mediaPreviewConfig"),
        );
        vi.restoreAllMocks();
    });

    afterEach(() => {
        vi.mocked(DMRoomMap.shared().getUserIdForRoomId).mockReset();
        vi.mocked(AvatarModule.defaultAvatarUrlForString).mockClear();
    });

    it("should render as expected for a Room", () => {
        const room = new Room("!room:example.com", client, client.getSafeUserId());
        room.name = "test room";
        expect(render(<RoomAvatar room={room} />).container).toMatchSnapshot();
    });

    describe("group without a picture", () => {
        const groupRoom = (ids: string[]): Room => {
            const room = new Room("!group:example.com", client, client.getSafeUserId());
            room.name = "group";
            const members = ids.map((id) => {
                const m = new RoomMember(room.roomId, id);
                m.membership = "join";
                return m;
            });
            vi.spyOn(room, "getMyMembership").mockReturnValue("join");
            vi.spyOn(room, "getJoinedMembers").mockReturnValue(members);
            vi.spyOn(room, "getMember").mockImplementation((id) => members.find((m) => m.userId === id) ?? null);
            return room;
        };

        it("shows two members overlapping, Messenger-style", () => {
            const { container } = render(<RoomAvatar room={groupRoom(["@a:x", "@b:x"])} />);
            const petals = container.querySelectorAll(".mx_GroupMembersAvatar_petal");
            expect(petals).toHaveLength(2);
            // Only the back one is cut by the front one.
            expect((petals[0] as HTMLElement).style.maskImage).toBe("");
            expect((petals[1] as HTMLElement).style.maskImage).toContain("data:image/svg+xml");
            expect(container.querySelector(".mx_GroupMembersAvatar")).toHaveAttribute("aria-label", "group");
        });

        it("shows a three-petal pinwheel for three or more, skipping us", () => {
            const room = groupRoom([client.getSafeUserId(), "@a:x", "@b:x", "@c:x", "@d:x"]);
            const { container } = render(<RoomAvatar room={room} />);
            const petals = container.querySelectorAll<HTMLElement>(".mx_GroupMembersAvatar_petal");
            expect(petals).toHaveLength(3);
            for (const petal of petals) expect(petal.style.maskImage).toContain("data:image/svg+xml");
        });

        it("keeps the normal avatar with fewer than two others", () => {
            const { container } = render(<RoomAvatar room={groupRoom(["@a:x"])} />);
            expect(container.querySelector(".mx_GroupMembersAvatar")).toBeNull();
        });
    });

    it("should render as expected for a DM room", () => {
        const userId = "@dm_user@example.com";
        const room = new Room("!room:example.com", client, client.getSafeUserId());
        room.getMember = vi.fn().mockImplementation(() => new RoomMember(room.roomId, userId));
        room.name = "DM room";
        vi.mocked(DMRoomMap.shared().getUserIdForRoomId).mockReturnValue(userId);
        expect(render(<RoomAvatar room={room} />).container).toMatchSnapshot();
    });

    it("should render as expected for a LocalRoom", () => {
        const userId = "@local_room_user@example.com";
        const localRoom = new LocalRoom("!room:example.com", client, client.getSafeUserId());
        localRoom.name = "local test room";
        localRoom.targets.push(new DirectoryMember({ user_id: userId }));
        expect(render(<RoomAvatar room={localRoom} />).container).toMatchSnapshot();
    });
    it("should render an avatar for a room the user is invited to", () => {
        const room = new Room("!room:example.com", client, client.getSafeUserId());
        vi.spyOn(room, "getMxcAvatarUrl").mockImplementation(() => "mxc://example.com/foobar");
        room.name = "test room";
        room.updateMyMembership("invite");
        room.currentState.setStateEvents([
            new MatrixEvent({
                sender: "@sender:server",
                room_id: room.roomId,
                type: EventType.RoomAvatar,
                state_key: "",
                content: {
                    url: "mxc://example.com/foobar",
                },
            }),
        ]);
        expect(render(<RoomAvatar room={room} />).container).toMatchSnapshot();
    });
    it("should not render an invite avatar if the user has disabled it", () => {
        SettingsStore.setValue("mediaPreviewConfig", null, SettingLevel.ACCOUNT, {
            invite_avatars: MediaPreviewValue.Off,
        });
        const room = new Room("!room:example.com", client, client.getSafeUserId());
        room.name = "test room";
        room.updateMyMembership("invite");
        expect(render(<RoomAvatar room={room} />).container).toMatchSnapshot();
    });
});
