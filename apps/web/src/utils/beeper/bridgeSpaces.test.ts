/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 */

import { describe, expect, it } from "vitest";
import { type Room } from "matrix-js-sdk/src/matrix";

import { isBridgePersonalSpace, withoutBridgeRoot } from "./bridgeSpaces";
import type { SpacePathEntry } from "../SpaceHierarchyUtils";

const ME = "@me:x";

function space(id: string, creator: string, members: string[], isSpace = true): Room {
    return {
        roomId: id,
        name: id,
        client: { getUserId: () => ME },
        isSpaceRoom: () => isSpace,
        getCreator: () => creator,
        getJoinedMembers: () => members.map((userId) => ({ userId })),
    } as unknown as Room;
}

const entry = (room: Room): SpacePathEntry => ({ id: room.roomId, name: room.name, room });

describe("bridge personal spaces in room paths", () => {
    const telegram = space("!tg:x", "@telegrambot:x", ["@telegrambot:x", ME]);
    const discordPersonal = space("!dc:x", "@discordbot:x", ["@discordbot:x", ME]);
    const guild = space("!guild:x", "@discordbot:x", ["@discordbot:x", ME, "@discord_1:x"]);
    const matrixSpace = space("!ms:x", "@alice:x", ["@alice:x", ME]);

    it("recognises a bridge bot's space holding only the bot and me", () => {
        expect(isBridgePersonalSpace(telegram)).toBe(true);
        expect(isBridgePersonalSpace(discordPersonal)).toBe(true);
    });

    it("keeps real spaces: other members, a human creator, my own space, or a non-space", () => {
        expect(isBridgePersonalSpace(guild)).toBe(false);
        expect(isBridgePersonalSpace(matrixSpace)).toBe(false);
        expect(isBridgePersonalSpace(space("!mine:x", ME, [ME]))).toBe(false);
        expect(isBridgePersonalSpace(space("!room:x", "@telegrambot:x", ["@telegrambot:x", ME], false))).toBe(false);
    });

    it("drops only the bridge root and keeps the hierarchy below it", () => {
        expect(withoutBridgeRoot([entry(telegram)])).toEqual([]);
        expect(withoutBridgeRoot([entry(discordPersonal), entry(guild)]).map((e) => e.id)).toEqual(["!guild:x"]);
        expect(withoutBridgeRoot([entry(matrixSpace), entry(guild)]).map((e) => e.id)).toEqual(["!ms:x", "!guild:x"]);
        expect(withoutBridgeRoot([])).toEqual([]);
    });
});
