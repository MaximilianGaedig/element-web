/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Room } from "matrix-js-sdk/src/matrix";

import { isLegacyOnlyBridge, preferredCallPlatform } from "./callPlatform";
import { PlatformCallType } from "../../hooks/room/useRoomCall";

const config = { disable: false, use_exclusively: false };
let legacyCallsEnabled = true;
let ongoingCall: object | null = null;
let transports = [{ type: "livekit", livekit_service_url: "https://rtc.example.org" }];
let bridged = true;

vi.mock("../../hooks/room/useRoomCall", () => ({ PlatformCallType: { ElementCall: 0, JitsiCall: 1, LegacyCall: 2 } }));
vi.mock("../../SdkConfig", () => ({ default: { get: () => config } }));
vi.mock("../../settings/SettingsStore", () => ({ default: { getValue: () => legacyCallsEnabled } }));
vi.mock("../../stores/CallStore", () => ({
    CallStore: { instance: { getCall: () => ongoingCall, getConfiguredRTCTransports: () => transports } },
}));
vi.mock("../bridge/bridgeInfo", () => ({ getBridgeInfo: () => (bridged ? { networkName: "Messenger" } : undefined) }));

/** A chat whose power levels do or do not name the call membership event, as a bridge sets them. */
function room({ rtcInPowerLevels, mayJoinCalls = true }: { rtcInPowerLevels: boolean; mayJoinCalls?: boolean }): Room {
    const content = { events: rtcInPowerLevels ? { "org.matrix.msc3401.call.member": 0 } : {} };
    return {
        roomId: "!dm:example.org",
        client: {},
        currentState: {
            getStateEvents: () => ({ getContent: () => content }),
            mayClientSendStateEvent: () => mayJoinCalls,
        },
    } as unknown as Room;
}

describe("preferredCallPlatform", () => {
    beforeEach(() => {
        config.disable = false;
        config.use_exclusively = false;
        legacyCallsEnabled = true;
        ongoingCall = null;
        transports = [{ type: "livekit", livekit_service_url: "https://rtc.example.org" }];
        bridged = true;
    });

    // The Messenger bridge rings Messenger for a MatrixRTC call, and ignored the legacy call Contacts forced.
    it("rings a chat whose bridge takes MatrixRTC calls with Element Call, as its header does", () => {
        const dm = room({ rtcInPowerLevels: true });
        expect(isLegacyOnlyBridge(dm)).toBe(false);
        expect(preferredCallPlatform(dm)).toBe(PlatformCallType.ElementCall);
    });

    it("keeps the legacy call for a bridge that only takes those", () => {
        const dm = room({ rtcInPowerLevels: false });
        expect(isLegacyOnlyBridge(dm)).toBe(true);
        expect(preferredCallPlatform(dm)).toBe(PlatformCallType.LegacyCall);
    });

    it("uses Element Call in an unbridged chat where it can, and the legacy call where the server has no transport", () => {
        bridged = false;
        expect(preferredCallPlatform(room({ rtcInPowerLevels: false }))).toBe(PlatformCallType.ElementCall);
        transports = [];
        expect(preferredCallPlatform(room({ rtcInPowerLevels: false }))).toBe(PlatformCallType.LegacyCall);
    });

    it("joins a call already going on, and never uses Element Call where it is turned off", () => {
        ongoingCall = {};
        expect(preferredCallPlatform(room({ rtcInPowerLevels: false }))).toBe(PlatformCallType.ElementCall);
        config.disable = true;
        expect(preferredCallPlatform(room({ rtcInPowerLevels: true }))).toBe(PlatformCallType.LegacyCall);
    });
});
