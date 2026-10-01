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

import { MatrixClientPeg } from "../../../MatrixClientPeg";
import MatrixClientContext from "../../../contexts/MatrixClientContext";
import { mkEvent, stubClient } from "test-utils";
import { ROOM_FEATURES_EVENT_TYPE } from "../../../utils/bridge/roomFeatures";
import { canSendViewOnce, isViewOnceEvent, VIEW_LIMITED_KEY } from "../../../utils/bridge/viewOnce";
import ViewOnceBadge from "./ViewOnceBadge";

const ROOM_ID = "!portal:example.org";
const GHOST = "@whatsapp_123:example.org";

const photo = new File(["x"], "photo.jpg", { type: "image/jpeg" });
const video = new File(["x"], "clip.mp4", { type: "video/mp4" });
const voice = new File(["x"], "voice.ogg", { type: "audio/ogg" });
const document = new File(["x"], "notes.pdf", { type: "application/pdf" });

describe("view-once media", () => {
    let client: MatrixClient;
    let room: Room;

    const setFeatures = (file: Record<string, unknown>): void => {
        room.currentState.setStateEvents([
            mkEvent({
                event: true,
                type: "m.bridge",
                skey: "whatsapp",
                room: ROOM_ID,
                user: "@bot:x",
                content: { protocol: { id: "whatsapp", displayname: "WhatsApp" } },
            }),
            mkEvent({
                event: true,
                type: ROOM_FEATURES_EVENT_TYPE,
                skey: "whatsapp",
                room: ROOM_ID,
                user: "@bot:x",
                content: { file },
            }),
        ]);
    };

    const mkMedia = (limit: unknown, sender = client.getSafeUserId()): MatrixEvent =>
        mkEvent({
            event: true,
            type: "m.room.message",
            room: ROOM_ID,
            user: sender,
            content: {
                msgtype: "m.image",
                body: "photo.jpg",
                url: "mxc://example.org/abc",
                ...(limit === undefined ? {} : { [VIEW_LIMITED_KEY]: limit }),
            },
        });

    beforeEach(() => {
        stubClient();
        client = MatrixClientPeg.safeGet();
        room = new Room(ROOM_ID, client, client.getSafeUserId(), {
            pendingEventOrdering: PendingEventOrdering.Detached,
        });
        vi.spyOn(client, "getRoom").mockReturnValue(room);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("canSendViewOnce", () => {
        it("is false in a room without a bridge", () => {
            expect(canSendViewOnce(room, photo)).toBe(false);
            expect(canSendViewOnce(null, photo)).toBe(false);
        });

        it("is false when the bridge does not declare a view limit", () => {
            setFeatures({ "m.image": { mime_types: { "image/*": 2 } }, "m.video": { mime_types: { "video/*": 2 } } });
            expect(canSendViewOnce(room, photo)).toBe(false);
            expect(canSendViewOnce(room, video)).toBe(false);
        });

        it("follows the declared limits of the file's message type", () => {
            setFeatures({
                "m.image": { mime_types: { "image/*": 2 }, view_limited_types: [{ type: "count", count: 1 }] },
                "m.video": { mime_types: { "video/*": 2 } },
            });
            expect(canSendViewOnce(room, photo)).toBe(true);
            expect(canSendViewOnce(room, video)).toBe(false);
        });

        it("needs exactly the view-once limit: the bridge refuses any other", () => {
            setFeatures({
                "m.image": { view_limited_types: [{ type: "time", time: 10000 }] },
                "m.video": { view_limited_types: [{ type: "count", count: 2 }] },
            });
            expect(canSendViewOnce(room, photo)).toBe(false);
            expect(canSendViewOnce(room, video)).toBe(false);
        });

        it("is only for pictures and videos", () => {
            const viewOnce = { view_limited_types: [{ type: "count", count: 1 }] };
            setFeatures({ "m.image": viewOnce, "m.video": viewOnce, "m.audio": viewOnce, "m.file": viewOnce });
            expect(canSendViewOnce(room, photo)).toBe(true);
            expect(canSendViewOnce(room, video)).toBe(true);
            expect(canSendViewOnce(room, voice)).toBe(false);
            expect(canSendViewOnce(room, document)).toBe(false);
        });
    });

    it("recognises a view-once event", () => {
        expect(isViewOnceEvent(mkMedia({ type: "count", count: 1 }))).toBe(true);
        expect(isViewOnceEvent(mkMedia(undefined))).toBe(false);
        expect(isViewOnceEvent(mkMedia(true))).toBe(false);
        expect(isViewOnceEvent(mkMedia({ type: "count", count: 3 }))).toBe(false);
    });

    describe("<ViewOnceBadge />", () => {
        const renderBadge = (mxEvent: MatrixEvent): ReturnType<typeof render> =>
            render(
                <MatrixClientContext.Provider value={client}>
                    <ViewOnceBadge mxEvent={mxEvent} />
                </MatrixClientContext.Provider>,
            );

        it("marks our own view-once message, and says our copy stays", () => {
            setFeatures({ "m.image": { view_limited_types: [{ type: "count", count: 1 }] } });
            renderBadge(mkMedia({ type: "count", count: 1 }));

            const badge = screen.getByText("View once");
            expect(badge).toHaveClass("mx_ViewOnceBadge");
            expect(badge).toHaveAccessibleName("Sent to be viewed once on WhatsApp. Your copy here stays viewable.");
        });

        it("marks somebody else's view-once message", () => {
            renderBadge(mkMedia({ type: "count", count: 1 }, GHOST));

            expect(screen.getByText("View once")).not.toHaveAttribute("aria-label");
        });

        it("shows nothing on ordinary media", () => {
            const { container } = renderBadge(mkMedia(undefined));

            expect(container).toBeEmptyDOMElement();
        });
    });
});
