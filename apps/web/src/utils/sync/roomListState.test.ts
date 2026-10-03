/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, it, expect } from "vitest";

import { ROOM_LIST_STATE_TYPES, roomListRequiredState } from "./roomListState";

describe("roomListRequiredState", () => {
    // Asked for separately, the two ways of syncing drifted: a type added for the chat list reached one only.
    it("asks sliding sync for every type the chat list reads", () => {
        const asked = new Set(roomListRequiredState().map(([type]) => type));
        for (const type of ROOM_LIST_STATE_TYPES) expect(asked).toContain(type);
    });

    it("asks for one-per-room state by its empty key and the rest with all keys", () => {
        const asked = Object.fromEntries(roomListRequiredState().filter(([type]) => type !== "m.room.member"));
        expect(asked["m.room.name"]).toBe("");
        expect(asked["m.bridge"]).toBe("*");
        expect(asked["m.space.child"]).toBe("*");
    });

    it("asks for our own membership and the members the latest messages need", () => {
        const members = roomListRequiredState()
            .filter(([type]) => type === "m.room.member")
            .map(([, key]) => key);
        expect(members).toEqual(["$ME", "$LAZY"]);
    });
});
