/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Which kind of call a chat is rung with, for the places that ring a chat without its header: the contact card,
 * the people list's menu, the call list. They forced the legacy 1:1 call, which a bridge that takes MatrixRTC
 * calls (the Messenger bridge; Element X) does not ring with, while the header rang the same chat with Element
 * Call. The header's own choice (useRoomCall) reads the same rules from here.
 */

import { EventType, type Room } from "matrix-js-sdk/src/matrix";

import SdkConfig from "../../SdkConfig";
import SettingsStore from "../../settings/SettingsStore";
import { CallStore } from "../../stores/CallStore";
import { ElementCallMemberEventType } from "../../call-types";
import { getBridgeInfo } from "../bridge/bridgeInfo";
import { PlatformCallType } from "../../hooks/room/useRoomCall";

/**
 * Whether a bridged chat only takes legacy 1:1 calls. A bridge that takes MatrixRTC calls says so by letting
 * portal members send call memberships explicitly; the portal's state_default otherwise keeps them out.
 */
export function isLegacyOnlyBridge(room: Room): boolean {
    if (!getBridgeInfo(room)) return false;
    const pl = room.currentState.getStateEvents(EventType.RoomPowerLevels, "")?.getContent();
    return pl?.events?.[ElementCallMemberEventType.name] === undefined;
}

/** Whether the homeserver offers a MatrixRTC transport, without which Element Call cannot connect. */
function serverHasElementCall(): boolean {
    return CallStore.instance
        .getConfiguredRTCTransports()
        .some((transport) => transport.type === "livekit" && !!transport.livekit_service_url);
}

/**
 * The kind of call to ring a one-to-one chat with when there is no header to choose one: Element Call where the
 * chat and the server take it, as the header does, and the legacy 1:1 call otherwise.
 */
export function preferredCallPlatform(room: Room): PlatformCallType {
    const config = SdkConfig.get("element_call");
    if (config.disable) return PlatformCallType.LegacyCall;
    // A call already going on in the chat is joined rather than rung over.
    if (CallStore.instance.getCall(room.roomId)) return PlatformCallType.ElementCall;
    if (!SettingsStore.getValue("enableLegacyCallsVoip") || config.use_exclusively) {
        return PlatformCallType.ElementCall;
    }
    const mayCreate =
        room.currentState.mayClientSendStateEvent(ElementCallMemberEventType.name, room.client) &&
        serverHasElementCall();
    return mayCreate && !isLegacyOnlyBridge(room) ? PlatformCallType.ElementCall : PlatformCallType.LegacyCall;
}
