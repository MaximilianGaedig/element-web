/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it, vi } from "vitest";
import { CallType } from "matrix-js-sdk/src/webrtc/call";

import { placeCall } from "./placeCall";
import { PlatformCallType } from "../../hooks/room/useRoomCall";
import type LegacyCallHandler from "../../LegacyCallHandler";
import type { Room } from "matrix-js-sdk/src/matrix";

vi.mock("../../PosthogTrackers", () => ({
    default: { trackInteraction: vi.fn() },
}));

vi.mock("../../hooks/room/useRoomCall", () => ({
    PlatformCallType: {
        ElementCall: 0,
        JitsiCall: 1,
        LegacyCall: 2,
    },
    getPlatformCallTypeProps: vi.fn(() => ({ analyticsName: "WebVoipOptionLegacy" })),
}));

vi.mock("../../dispatcher/dispatcher", () => ({
    default: { dispatch: vi.fn() },
}));

describe("placeCall", () => {
    it("preserves an explicit legacy selection for bridged DMs", async () => {
        const legacyCallHandler = { placeCall: vi.fn() } as unknown as LegacyCallHandler;
        const room = { roomId: "!bridged-dm:example.org" } as Room;

        await placeCall(legacyCallHandler, room, CallType.Voice, PlatformCallType.LegacyCall, undefined, true);

        expect(legacyCallHandler.placeCall).toHaveBeenCalledWith(room.roomId, CallType.Voice, undefined, true);
    });

    it("does not force Matrix calling for an explicit Jitsi selection", async () => {
        const legacyCallHandler = { placeCall: vi.fn() } as unknown as LegacyCallHandler;
        const room = { roomId: "!group:example.org" } as Room;

        await placeCall(legacyCallHandler, room, CallType.Video, PlatformCallType.JitsiCall, undefined, false);

        expect(legacyCallHandler.placeCall).toHaveBeenCalledWith(room.roomId, CallType.Video, undefined, false);
    });
});
