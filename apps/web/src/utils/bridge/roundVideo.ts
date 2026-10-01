/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type MatrixEvent, MsgType } from "matrix-js-sdk/src/matrix";

/**
 * `info` flag of an m.video that is a round "video note". mautrix-telegram sets it on the round videos it
 * bridges in; bridges that can send one (WhatsApp) take a video carrying it as a video note.
 */
export const ROUND_VIDEO_KEY = "fi.mau.telegram.round_message";

/** Whether the event is a round video note. */
export function isRoundVideo(mxEvent: MatrixEvent): boolean {
    const content = mxEvent.getContent();
    return content.msgtype === MsgType.Video && content.info?.[ROUND_VIDEO_KEY] === true;
}
