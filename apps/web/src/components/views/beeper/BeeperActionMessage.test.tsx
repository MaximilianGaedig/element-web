/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen } from "test-utils-rtl";
import { type MatrixClient, type MatrixEvent, PendingEventOrdering, Room } from "matrix-js-sdk/src/matrix";

import EventTile from "../rooms/EventTile";
import MatrixClientContext from "../../../contexts/MatrixClientContext";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import { ScopedRoomContextProvider } from "../../../contexts/ScopedRoomContext";
import { TimelineRenderingType } from "../../../contexts/RoomContext";
import SettingsStore from "../../../settings/SettingsStore";
import { BeeperActionMessageFactory, pickFactory } from "../../../events/EventTileFactory";
import { getEventDisplayInfo } from "../../../utils/EventRenderingUtils";
import { getRoomContext, mkEvent, stubClient } from "test-utils";

const ROOM_ID = "!portal:example.org";

describe("com.beeper.action_message", () => {
    let client: MatrixClient;
    let room: Room;

    const mkAction = (action: unknown, body = "Missed video call"): MatrixEvent =>
        mkEvent({
            event: true,
            type: "m.room.message",
            room: ROOM_ID,
            user: "@whatsapp_123:example.org",
            content: { "msgtype": "m.notice", body, "com.beeper.action_message": action },
        });

    beforeEach(() => {
        stubClient();
        client = MatrixClientPeg.safeGet();
        room = new Room(ROOM_ID, client, client.getSafeUserId(), {
            pendingEventOrdering: PendingEventOrdering.Detached,
        });
        vi.spyOn(client, "getRoom").mockReturnValue(room);
        vi.spyOn(SettingsStore, "getValue").mockReturnValue(false);
    });

    afterEach(() => vi.restoreAllMocks());

    it("picks the action factory and renders as an info line", () => {
        const ev = mkAction({ type: "call", call_type: "video" });
        expect(pickFactory(ev, client, false)).toBe(BeeperActionMessageFactory);
        expect(getEventDisplayInfo(client, ev, false).isInfoMessage).toBe(true);

        const plain = mkAction(undefined, "hello");
        expect(pickFactory(plain, client, false)).not.toBe(BeeperActionMessageFactory);
        expect(getEventDisplayInfo(client, plain, false).isInfoMessage).toBe(false);
    });

    it("renders a compact call line with an icon in the timeline", () => {
        const ev = mkAction({ type: "call", call_type: "video" });
        const { container } = render(
            <MatrixClientContext.Provider value={client}>
                <ScopedRoomContextProvider
                    {...getRoomContext(room, { timelineRenderingType: TimelineRenderingType.Room })}
                >
                    <EventTile mxEvent={ev} />
                </ScopedRoomContextProvider>
            </MatrixClientContext.Provider>,
        );
        // Info tiles get the shared EventTileView's (CSS-module) "stateInfo" state class.
        expect(container.querySelector(".mx_EventTile")?.className).toMatch(/stateInfo/);
        const line = container.querySelector(".mx_BeeperActionMessage");
        expect(line).toHaveAttribute("data-action-type", "call");
        expect(line?.querySelector("svg")).toBeInTheDocument();
        expect(screen.getByText("Missed video call")).toBeInTheDocument();
    });
});
