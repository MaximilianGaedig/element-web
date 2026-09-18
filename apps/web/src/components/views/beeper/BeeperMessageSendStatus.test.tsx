/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { act, render, screen } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";
import { type MatrixClient, type MatrixEvent, PendingEventOrdering, Room, RoomEvent } from "matrix-js-sdk/src/matrix";

import BeeperMessageSendStatus from "./BeeperMessageSendStatus";
import MatrixClientContext from "../../../contexts/MatrixClientContext";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import { mkEvent, stubClient } from "test-utils";
import { MESSAGE_SEND_STATUS_EVENT_TYPE, parseMessageSendStatus } from "../../../utils/beeper/messageSendStatus";

const ROOM_ID = "!portal:example.org";
const BOT = "@telegrambot:example.org";

describe("<BeeperMessageSendStatus />", () => {
    let client: MatrixClient;
    let room: Room;
    let msg: MatrixEvent;
    let seq = 0;

    const mkStatus = (content: Record<string, unknown>, ts = 1000 + seq): MatrixEvent =>
        mkEvent({
            event: true,
            type: MESSAGE_SEND_STATUS_EVENT_TYPE,
            room: ROOM_ID,
            user: BOT,
            id: `$status${++seq}`,
            ts,
            content: { "m.relates_to": { rel_type: "m.reference", event_id: msg.getId() }, ...content },
        });

    const emit = (ev: MatrixEvent): void => {
        act(() => {
            client.emit(RoomEvent.Timeline, ev, room, false, false, {} as any);
        });
    };

    const renderStatus = (): ReturnType<typeof render> =>
        render(
            <MatrixClientContext.Provider value={client}>
                <BeeperMessageSendStatus mxEvent={msg} />
            </MatrixClientContext.Provider>,
        );

    beforeEach(() => {
        stubClient();
        client = MatrixClientPeg.safeGet();
        room = new Room(ROOM_ID, client, client.getSafeUserId(), {
            pendingEventOrdering: PendingEventOrdering.Detached,
        });
        vi.spyOn(client, "getRoom").mockReturnValue(room);
        msg = mkEvent({
            event: true,
            type: "m.room.message",
            room: ROOM_ID,
            user: client.getSafeUserId(),
            id: `$msg${++seq}`,
            content: { msgtype: "m.text", body: "hi" },
        });
    });

    it("parses status events and ignores junk", () => {
        expect(parseMessageSendStatus(mkStatus({ status: "SUCCESS", network: "telegram" }))?.[1]).toMatchObject({
            status: "SUCCESS",
            network: "telegram",
        });
        expect(parseMessageSendStatus(mkStatus({ status: "BOGUS" }))).toBeUndefined();
        expect(parseMessageSendStatus(msg)).toBeUndefined();
    });

    it("renders nothing without a status, or for a plain success", () => {
        const { container } = renderStatus();
        expect(container).toBeEmptyDOMElement();
        emit(mkStatus({ status: "SUCCESS" }));
        expect(container).toBeEmptyDOMElement();
    });

    it("shows a failure with the bridge's message and a retry button that re-sends with retry metadata", async () => {
        renderStatus();
        emit(mkStatus({ status: "FAIL_RETRIABLE", network: "Telegram", message: "flood wait" }));

        expect(screen.getByRole("status")).toHaveTextContent("Not delivered to Telegram: flood wait");
        await userEvent.click(screen.getByRole("button", { name: /Retry/ }));
        expect(client.sendEvent).toHaveBeenCalledWith(
            ROOM_ID,
            "m.room.message",
            expect.objectContaining({
                "body": "hi",
                "com.beeper.message_send_retry": { original_event_id: msg.getId(), retry_count: 1 },
            }),
        );
    });

    it("offers no retry for permanent failures and explains the reason", () => {
        renderStatus();
        emit(mkStatus({ status: "FAIL_PERMANENT", reason: "com.beeper.unsupported_event", network: "WhatsApp" }));
        expect(screen.getByRole("status")).toHaveTextContent("isn't supported there");
        expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("keeps the newest status and shows remote delivery", () => {
        const { container } = renderStatus();
        emit(mkStatus({ status: "FAIL_RETRIABLE" }, 2000));
        emit(mkStatus({ status: "PENDING" }, 1000)); // older, ignored
        expect(screen.getByRole("status")).toHaveTextContent("Not delivered");
        emit(mkStatus({ status: "SUCCESS", delivered_to_users: ["@telegram_1:example.org"] }, 3000));
        expect(container.querySelector(".mx_BeeperSendStatus_delivered")).toBeInTheDocument();
    });

    it("picks up status events already in the timeline", () => {
        room.getLiveTimeline().addEvent(mkStatus({ status: "PENDING" }), {
            toStartOfTimeline: false,
            addToState: false,
        });
        const { container } = renderStatus();
        expect(container.querySelector(".mx_BeeperSendStatus_pending")).toBeInTheDocument();
    });

    it("ignores statuses on other people's messages", () => {
        msg = mkEvent({
            event: true,
            type: "m.room.message",
            room: ROOM_ID,
            user: "@someone:example.org",
            id: "$theirs",
            content: { msgtype: "m.text", body: "x" },
        });
        const { container } = renderStatus();
        emit(mkStatus({ status: "FAIL_PERMANENT" }));
        expect(container).toBeEmptyDOMElement();
    });
});
