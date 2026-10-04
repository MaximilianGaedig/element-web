/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, it, expect } from "vitest";

import { OPEN_ROOM_STATE, ROOM_LIST_STATE_TYPES, roomListRequiredState } from "./roomListState";
import { WIDGET_LAYOUT_EVENT_TYPE } from "../../stores/widgets/types";
import { JitsiCallMemberEventType } from "../../call-types";
import { ROOM_FEATURES_EVENT_TYPE } from "../bridge/roomFeatures";
import { BRIDGE_SETTINGS_EVENT_TYPE } from "../bridge/declaredSettings";
import { BOT_COMMANDS_EVENT_TYPE } from "../bridge/botCommands";
import { DISAPPEARING_TIMER_KEY } from "../bridge/disappearingMessages";
import { BACKFILL_SUMMARY_EVENT_TYPE } from "../importOverview";

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

describe("OPEN_ROOM_STATE", () => {
    // Written out as strings to keep heavy modules off the sync path: they must still be the types those read.
    it("names the types the open room's features read", () => {
        const asked = new Set(OPEN_ROOM_STATE.map(([type]) => type));
        for (const type of [
            WIDGET_LAYOUT_EVENT_TYPE,
            JitsiCallMemberEventType,
            ROOM_FEATURES_EVENT_TYPE,
            BRIDGE_SETTINGS_EVENT_TYPE,
            BOT_COMMANDS_EVENT_TYPE,
            DISAPPEARING_TIMER_KEY,
            BACKFILL_SUMMARY_EVENT_TYPE,
        ]) {
            expect(asked).toContain(type);
        }
    });
});
