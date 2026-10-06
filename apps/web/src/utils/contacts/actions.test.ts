/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it, vi } from "vitest";
import { CallType } from "matrix-js-sdk/src/webrtc/call";

import { callInRoom } from "./actions";
import { placeCall } from "../room/placeCall";
import { PlatformCallType } from "../../hooks/room/useRoomCall";

const { dm, legacyCallHandler } = vi.hoisted(() => ({
    dm: { roomId: "!dm:example.org" },
    legacyCallHandler: { placeCall: vi.fn() },
}));

vi.mock("../../hooks/room/useRoomCall", () => ({ PlatformCallType: { ElementCall: 0, JitsiCall: 1, LegacyCall: 2 } }));
vi.mock("../../MatrixClientPeg", () => ({ MatrixClientPeg: { safeGet: () => ({ getRoom: () => dm }) } }));
vi.mock("../../contexts/SDKContextClass", () => ({ SDKContextClass: { instance: { legacyCallHandler } } }));
vi.mock("../../dispatcher/dispatcher", () => ({ default: { dispatch: vi.fn(), register: vi.fn() } }));
vi.mock("../direct-messages", () => ({ DirectoryMember: vi.fn(), startDmOnFirstMessage: vi.fn() }));
vi.mock("../room/placeCall", () => ({ placeCall: vi.fn() }));
vi.mock("../room/callPlatform", () => ({ preferredCallPlatform: () => PlatformCallType.ElementCall }));

describe("callInRoom", () => {
    // Contacts forced the legacy 1:1 call, which the chat's bridge did not ring with: it rang nobody.
    it("rings the chat the way its header would, by voice unless video was asked for", () => {
        callInRoom(dm.roomId, false);
        expect(placeCall).toHaveBeenLastCalledWith(
            legacyCallHandler,
            dm,
            CallType.Voice,
            PlatformCallType.ElementCall,
            undefined,
            true,
        );
        expect(legacyCallHandler.placeCall).not.toHaveBeenCalled();

        callInRoom(dm.roomId, true);
        expect(placeCall).toHaveBeenLastCalledWith(
            legacyCallHandler,
            dm,
            CallType.Video,
            PlatformCallType.ElementCall,
            undefined,
            false,
        );
    });
});
