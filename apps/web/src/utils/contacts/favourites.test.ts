/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it, vi, afterEach } from "vitest";
import { type MatrixClient, type Room } from "matrix-js-sdk/src/matrix";

import { favourites } from "./favourites";
import DMRoomMap from "../DMRoomMap";

const room = (roomId: string, name: string, tags: Record<string, Record<string, unknown>>, avatar?: string): Room =>
    ({
        roomId,
        name,
        tags,
        getMxcAvatarUrl: () => avatar ?? null,
        getAvatarFallbackMember: () => undefined,
    }) as unknown as Room;

const clientWith = (...rooms: Room[]): MatrixClient => ({ getVisibleRooms: () => rooms }) as unknown as MatrixClient;

const dms = (...roomIds: string[]): void => {
    vi.spyOn(DMRoomMap, "shared").mockReturnValue({ getRoomIds: () => new Set(roomIds) } as unknown as DMRoomMap);
};

afterEach(() => vi.restoreAllMocks());

describe("favourites", () => {
    it("has none before the DM map exists, rather than throwing into the render", () => {
        vi.spyOn(DMRoomMap, "shared").mockReturnValue(undefined as unknown as DMRoomMap);
        expect(favourites(clientWith(room("!dm:e", "Ada", { "m.favourite": {} })))).toEqual([]);
    });

    it("takes only favourite direct chats", () => {
        dms("!dm:e", "!plain:e");
        const found = favourites(
            clientWith(
                room("!dm:e", "Ada", { "m.favourite": {} }),
                room("!plain:e", "Bob", {}),
                room("!group:e", "Team", { "m.favourite": {} }),
            ),
        );
        expect(found.map((one) => one.name)).toEqual(["Ada"]);
    });

    it("keeps the order the reader dragged them into, and sorts the rest by name after", () => {
        dms("!a:e", "!b:e", "!c:e", "!d:e");
        const found = favourites(
            clientWith(
                room("!a:e", "Zoe", { "m.favourite": { order: 0.9 } }),
                room("!b:e", "Bob", {}),
                room("!c:e", "Ada", { "m.favourite": { order: 0.1 } }),
                room("!d:e", "Cyd", { "m.favourite": {} }),
            ),
        );
        // Ordered first in their order, then the unordered one - never interleaved with them.
        expect(found.map((one) => one.name)).toEqual(["Ada", "Zoe", "Cyd"]);
    });

    it("falls back to the other member's face when the chat has no avatar", () => {
        dms("!dm:e");
        const one = room("!dm:e", "Ada", { "m.favourite": {} });
        one.getAvatarFallbackMember = () => ({ getMxcAvatarUrl: () => "mxc://e/ada" }) as never;
        expect(favourites(clientWith(one))[0].avatarUrl).toBe("mxc://e/ada");
    });

    it("stops at the limit", () => {
        const many = Array.from({ length: 20 }, (_, at) => room(`!${at}:e`, `P${at}`, { "m.favourite": {} }));
        dms(...many.map((one) => one.roomId));
        expect(favourites(clientWith(...many), { limit: 3 })).toHaveLength(3);
    });
});
