/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { EventType, type MatrixEvent } from "matrix-js-sdk/src/matrix";

/** Content key marking a message as a system-style action (e.g. a call on the remote network). */
export const ACTION_MESSAGE_KEY = "com.beeper.action_message";

export interface ActionMessage {
    /** Currently only "call" is defined by mautrix-go. */
    type: string;
    call_type?: "voice" | "video";
}

/** The action a message describes, if it is a Beeper action message. */
export function getActionMessage(mxEvent: MatrixEvent): ActionMessage | undefined {
    if (mxEvent.getType() !== EventType.RoomMessage || mxEvent.isRedacted()) return undefined;
    const raw = mxEvent.getContent()?.[ACTION_MESSAGE_KEY];
    if (!raw || typeof raw !== "object" || typeof raw.type !== "string") return undefined;
    const action: ActionMessage = { type: raw.type };
    if (raw.call_type === "voice" || raw.call_type === "video") action.call_type = raw.call_type;
    return action;
}
