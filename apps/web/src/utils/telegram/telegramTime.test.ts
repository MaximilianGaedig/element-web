/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect } from "vitest";
import { EventStatus, EventType, MsgType } from "matrix-js-sdk/src/matrix";

import {
    getEventIdsReadByOthers,
    getTelegramSendState,
    getTelegramTimePlacement,
    hasMediaCaption,
} from "./telegramTime";
import { mkEvent } from "test-utils";

const mkMsg = (content: Record<string, unknown>, type: string = EventType.RoomMessage) =>
    mkEvent({ event: true, type, room: "!r:x", user: "@a:x", content });

describe("getTelegramSendState", () => {
    it("follows the local echo while sending", () => {
        expect(getTelegramSendState({ eventSendStatus: EventStatus.SENDING })).toBe("sending");
        expect(getTelegramSendState({ eventSendStatus: EventStatus.ENCRYPTING })).toBe("sending");
        expect(getTelegramSendState({ eventSendStatus: EventStatus.QUEUED })).toBe("sending");
        expect(getTelegramSendState({ eventSendStatus: EventStatus.NOT_SENT })).toBe("error");
        expect(getTelegramSendState({ eventSendStatus: EventStatus.CANCELLED })).toBe("error");
    });

    it("shows one tick once the server has it", () => {
        expect(getTelegramSendState({})).toBe("sent");
        expect(getTelegramSendState({ eventSendStatus: EventStatus.SENT })).toBe("sent");
    });

    it("uses the bridge's message send status", () => {
        expect(getTelegramSendState({ bridgeStatus: "PENDING" })).toBe("sending");
        expect(getTelegramSendState({ bridgeStatus: "SUCCESS" })).toBe("delivered");
        expect(getTelegramSendState({ bridgeDelivered: true })).toBe("delivered");
        expect(getTelegramSendState({ bridgeStatus: "FAIL_RETRIABLE" })).toBe("error");
        expect(getTelegramSendState({ bridgeStatus: "FAIL_PERMANENT", readByOthers: true })).toBe("error");
    });

    it("prefers read over delivered", () => {
        expect(getTelegramSendState({ bridgeStatus: "SUCCESS", readByOthers: true })).toBe("read");
        expect(getTelegramSendState({ readByOthers: true })).toBe("read");
    });

    it("a failed local send wins over everything", () => {
        expect(
            getTelegramSendState({
                eventSendStatus: EventStatus.NOT_SENT,
                bridgeStatus: "SUCCESS",
                readByOthers: true,
            }),
        ).toBe("error");
    });
});

describe("getTelegramTimePlacement", () => {
    it("puts the time in the text of text messages", () => {
        expect(getTelegramTimePlacement(mkMsg({ msgtype: MsgType.Text, body: "hi" }))).toBe("inline");
        expect(getTelegramTimePlacement(mkMsg({ msgtype: MsgType.File, body: "a.pdf" }))).toBe("inline");
    });

    it("floats the time over photos, videos and stickers", () => {
        expect(getTelegramTimePlacement(mkMsg({ msgtype: MsgType.Image, body: "a.jpg" }))).toBe("floating");
        expect(getTelegramTimePlacement(mkMsg({ msgtype: MsgType.Video, body: "a.mp4" }))).toBe("floating");
        expect(getTelegramTimePlacement(mkMsg({ body: "sticker" }, EventType.Sticker))).toBe("floating");
    });

    it("puts the time in the caption of captioned media", () => {
        const captioned = mkMsg({ msgtype: MsgType.Image, body: "look", filename: "a.jpg" });
        expect(hasMediaCaption(captioned)).toBe(true);
        expect(getTelegramTimePlacement(captioned)).toBe("inline");
        expect(hasMediaCaption(mkMsg({ msgtype: MsgType.Image, body: "a.jpg", filename: "a.jpg" }))).toBe(false);
    });
});

describe("getEventIdsReadByOthers", () => {
    const ids = ["$1", "$2", "$3", "$4"];

    it("marks everything up to the newest receipt as read", () => {
        const receipts = new Map([["$2", [{ userId: "@bob:x" }]]]);
        expect([...getEventIdsReadByOthers(ids, receipts)]).toEqual(["$1", "$2"]);
    });

    it("uses the newest receipt of anyone", () => {
        const receipts = new Map([
            ["$1", [{ userId: "@bob:x" }]],
            ["$3", [{ userId: "@carol:x" }]],
        ]);
        expect([...getEventIdsReadByOthers(ids, receipts)]).toEqual(["$1", "$2", "$3"]);
    });

    it("ignores the bridge bot's receipts", () => {
        const receipts = new Map([
            ["$1", [{ userId: "@bob:x" }]],
            ["$4", [{ userId: "@telegrambot:x" }]],
        ]);
        expect([...getEventIdsReadByOthers(ids, receipts, new Set(["@telegrambot:x"]))]).toEqual(["$1"]);
    });

    it("is empty without receipts", () => {
        expect(getEventIdsReadByOthers(ids, new Map()).size).toBe(0);
    });
});
