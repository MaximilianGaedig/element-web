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
import { getRoomContext, mkEvent, stubClient } from "test-utils";
import {
    getPerMessageProfile,
    PER_MESSAGE_PROFILE_KEY,
    stripPerMessageProfileFallback,
} from "../../../utils/beeper/perMessageProfile";

const ROOM_ID = "!portal:example.org";
const RELAY = "@relaybot:example.org";

function mkRelayed(content: Record<string, unknown>): MatrixEvent {
    return mkEvent({ event: true, type: "m.room.message", room: ROOM_ID, user: RELAY, content });
}

describe("per-message profiles", () => {
    let client: MatrixClient;
    let room: Room;

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

    const renderTile = (mxEvent: MatrixEvent): ReturnType<typeof render> =>
        render(
            <MatrixClientContext.Provider value={client}>
                <ScopedRoomContextProvider
                    {...getRoomContext(room, { timelineRenderingType: TimelineRenderingType.Room })}
                >
                    <EventTile mxEvent={mxEvent} />
                </ScopedRoomContextProvider>
            </MatrixClientContext.Provider>,
        );

    it("parses the profile and ignores empty ones", () => {
        expect(getPerMessageProfile(mkRelayed({ msgtype: "m.text", body: "x" }))).toBeUndefined();
        expect(
            getPerMessageProfile(mkRelayed({ msgtype: "m.text", body: "x", [PER_MESSAGE_PROFILE_KEY]: { id: "a" } })),
        ).toBeUndefined();
        expect(
            getPerMessageProfile(
                mkRelayed({
                    msgtype: "m.text",
                    body: "x",
                    [PER_MESSAGE_PROFILE_KEY]: { id: "a", displayname: "Alice", avatar_url: "https://evil" },
                }),
            ),
        ).toEqual({ id: "a", displayname: "Alice" });
    });

    it("strips the plain and HTML fallback only when has_fallback is set", () => {
        const content = {
            msgtype: "m.text",
            body: "Alice: hello",
            format: "org.matrix.custom.html",
            formatted_body: "<strong data-mx-profile-fallback>Alice: </strong>hello <b>there</b>",
            [PER_MESSAGE_PROFILE_KEY]: { id: "a", displayname: "Alice", has_fallback: true },
        };
        const stripped = stripPerMessageProfileFallback(content);
        expect(stripped.body).toBe("hello");
        expect(stripped.formatted_body).toBe("hello <b>there</b>");
        expect(content.body).toBe("Alice: hello"); // not mutated

        const noFallback = { ...content, [PER_MESSAGE_PROFILE_KEY]: { id: "a", displayname: "Alice" } };
        expect(stripPerMessageProfileFallback(noFallback)).toBe(noFallback);
    });

    it("renders the per-message displayname and avatar instead of the relay sender", () => {
        const ev = mkRelayed({
            msgtype: "m.text",
            body: "Alice: hello from telegram",
            [PER_MESSAGE_PROFILE_KEY]: {
                id: "tg:123",
                displayname: "Alice",
                avatar_url: "mxc://example.org/alice",
                has_fallback: true,
            },
        });
        const { container } = renderTile(ev);

        expect(container.querySelector(".mx_DisambiguatedProfile")).toHaveTextContent("Alice");
        expect(container.querySelector(".mx_DisambiguatedProfile")).not.toHaveTextContent("relaybot");
        expect(screen.getByText("hello from telegram")).toBeInTheDocument();
        expect(screen.queryByText(/Alice: hello/)).not.toBeInTheDocument();
        const img = container.querySelector(".mx_BaseAvatar img, img.mx_BaseAvatar_image");
        expect(img?.getAttribute("src")).toContain("alice");
    });

    it("leaves normal messages alone", () => {
        const ev = mkRelayed({ msgtype: "m.text", body: "plain" });
        const { container } = renderTile(ev);
        expect(container.querySelector(".mx_DisambiguatedProfile")).toHaveTextContent(RELAY);
        expect(screen.getByText("plain")).toBeInTheDocument();
    });
});
