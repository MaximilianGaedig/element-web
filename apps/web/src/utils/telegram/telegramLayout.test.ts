/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PendingEventOrdering, Room } from "matrix-js-sdk/src/matrix";

import SettingsStore from "../../settings/SettingsStore";
import UIStore from "../../stores/UIStore";
import { ImageSize, suggestedSize } from "../../settings/enums/ImageSize";
import { effectiveImageSize, isOneToOneRoom, isTelegramLayout } from "./telegramLayout";
import { mkEvent, mkMembership, stubClient } from "test-utils";

describe("Telegram-style layout", () => {
    let telegram: boolean;

    beforeEach(() => {
        telegram = true;
        const original = SettingsStore.getValue.bind(SettingsStore);
        vi.spyOn(SettingsStore, "getValue").mockImplementation(((name: string, ...rest: any[]) => {
            if (name === "telegramStyleLayout") return telegram;
            if (name === "Images.size") return ImageSize.Large;
            return (original as any)(name, ...rest);
        }) as any);
        UIStore.instance.windowWidth = 1400;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("is on by default", () => {
        vi.restoreAllMocks();
        expect(isTelegramLayout()).toBe(true);
    });

    it("uses Telegram Web's media boxes instead of the image-size setting", () => {
        expect(effectiveImageSize()).toBe(ImageSize.Telegram);
        expect(suggestedSize(effectiveImageSize(), { w: 1920, h: 1080 })).toEqual({ w: 420, h: 236 });
        expect(suggestedSize(effectiveImageSize(), { w: 1080, h: 1920 })).toEqual({ w: 225, h: 400 });
        expect(suggestedSize(effectiveImageSize(true), { w: 512, h: 512 })).toEqual({ w: 200, h: 200 });

        UIStore.instance.windowWidth = 500;
        expect(suggestedSize(effectiveImageSize(), { w: 1920, h: 1080 })).toEqual({ w: 340, h: 191 });
        expect(suggestedSize(effectiveImageSize(true), { w: 512, h: 512 })).toEqual({ w: 180, h: 180 });

        telegram = false;
        expect(effectiveImageSize()).toBe(ImageSize.Large);
        expect(effectiveImageSize(true)).toBe(ImageSize.Large);
    });

    describe("isOneToOneRoom", () => {
        const ROOM_ID = "!room:example.org";
        const BOT = "@telegrambot:example.org";

        const makeRoom = (members: string[], bridgeRoomType?: string): Room => {
            const client = stubClient();
            const room = new Room(ROOM_ID, client, client.getSafeUserId(), {
                pendingEventOrdering: PendingEventOrdering.Detached,
            });
            const events = members.map((user) => mkMembership({ event: true, room: ROOM_ID, user, mship: "join" }));
            if (bridgeRoomType) {
                events.push(
                    mkEvent({
                        event: true,
                        type: "m.bridge",
                        skey: "telegram",
                        room: ROOM_ID,
                        user: BOT,
                        content: {
                            "bridgebot": BOT,
                            "protocol": { id: "telegram", displayname: "Telegram" },
                            "com.beeper.room_type": bridgeRoomType,
                        },
                    }),
                );
            }
            room.currentState.setStateEvents(events);
            return room;
        };

        it("treats two-member rooms and bridged DMs as one-to-one, but not groups", () => {
            expect(isOneToOneRoom(makeRoom(["@me:example.org", "@alice:example.org"]))).toBe(true);
            expect(isOneToOneRoom(makeRoom(["@me:example.org", BOT, "@telegram_1:example.org"], "dm"))).toBe(true);
            expect(isOneToOneRoom(makeRoom(["@me:example.org", BOT, "@telegram_1:example.org"], "group"))).toBe(false);
            expect(isOneToOneRoom(makeRoom(["@me:example.org", "@a:example.org", "@b:example.org"]))).toBe(false);
        });
    });
});
