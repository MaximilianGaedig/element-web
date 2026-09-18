/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React from "react";
import { render, screen } from "jest-matrix-react";
import { type MatrixClient, PendingEventOrdering, Room } from "matrix-js-sdk/src/matrix";

import MatrixClientContext from "../../../../../src/contexts/MatrixClientContext";
import { MatrixClientPeg } from "../../../../../src/MatrixClientPeg";
import { mkEvent, stubClient } from "../../../../test-utils";
import { describeBridge, getBridgeInfo } from "../../../../../src/utils/beeper/bridgeInfo";
import {
    BridgedRoomAvatar,
    BridgeNetworkHeaderBadge,
} from "../../../../../src/components/views/beeper/BridgeNetworkIcon";

const ROOM_ID = "!portal:example.org";

describe("bridge info (m.bridge + com.beeper.room_type)", () => {
    let client: MatrixClient;
    let room: Room;

    const setBridge = (content: Record<string, unknown>, type = "m.bridge"): void => {
        room.currentState.setStateEvents([
            mkEvent({ event: true, type, skey: "bridge", room: ROOM_ID, user: "@bot:example.org", content }),
        ]);
    };

    beforeEach(() => {
        stubClient();
        client = MatrixClientPeg.safeGet();
        room = new Room(ROOM_ID, client, client.getSafeUserId(), {
            pendingEventOrdering: PendingEventOrdering.Detached,
        });
    });

    it("parses bridgev2 info and room types", () => {
        expect(getBridgeInfo(room)).toBeUndefined();
        setBridge({
            "bridgebot": "@telegrambot:example.org",
            "protocol": { id: "telegram", displayname: "Telegram", avatar_url: "mxc://example.org/tg" },
            "channel": { id: "123" },
            "com.beeper.room_type": "dm",
            "com.beeper.room_type.v2": "dm",
        });
        const info = getBridgeInfo(room)!;
        expect(info).toEqual({
            protocolId: "telegram",
            networkName: "Telegram",
            avatarUrl: "mxc://example.org/tg",
            roomType: "dm",
            parentName: undefined,
        });
        expect(describeBridge(info)).toBe("Bridged from Telegram · Direct message");
    });

    it("handles legacy bridges via uk.half-shot.bridge and the parent network", () => {
        setBridge(
            {
                protocol: { id: "discordgo", displayname: "Discord" },
                network: { id: "guild", displayname: "My Server" },
                channel: { id: "c" },
            },
            "uk.half-shot.bridge",
        );
        expect(describeBridge(getBridgeInfo(room)!)).toBe("Bridged from Discord · My Server · Group chat");
    });

    it("renders a header badge and a room-list avatar overlay", () => {
        setBridge({
            "protocol": { id: "whatsapp", displayname: "WhatsApp" },
            "com.beeper.room_type.v2": "group_dm",
        });
        const { container } = render(
            <MatrixClientContext.Provider value={client}>
                <BridgeNetworkHeaderBadge room={room} />
                <BridgedRoomAvatar room={room}>
                    <span data-testid="avatar" />
                </BridgedRoomAvatar>
            </MatrixClientContext.Provider>,
        );
        expect(screen.getByLabelText("Bridged from WhatsApp · Group DM")).toHaveTextContent("WhatsApp");
        const wrapper = container.querySelector(".mx_BridgedRoomAvatar");
        expect(wrapper).toContainElement(screen.getByTestId("avatar"));
        expect(wrapper?.querySelector(".mx_BridgeNetworkIcon")).toBeInTheDocument();
    });

    it("renders nothing extra for unbridged rooms", () => {
        const { container } = render(
            <MatrixClientContext.Provider value={client}>
                <BridgeNetworkHeaderBadge room={room} />
                <BridgedRoomAvatar room={room}>
                    <span data-testid="avatar" />
                </BridgedRoomAvatar>
            </MatrixClientContext.Provider>,
        );
        expect(container.querySelector(".mx_BridgedRoomAvatar, .mx_BridgeNetworkHeaderBadge")).toBeNull();
        expect(screen.getByTestId("avatar")).toBeInTheDocument();
    });
});
