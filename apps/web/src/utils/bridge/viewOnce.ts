/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type MatrixEvent, MsgType, type Room } from "matrix-js-sdk/src/matrix";

import { getRoomFeatures, type ViewLimit } from "./roomFeatures";

/**
 * Top-level content field with which a media event asks the bridge to send it as view-limited media
 * (mautrix-go event.BeeperViewLimitedMedia). The bridge refuses the event unless the room's features
 * list exactly this limit for the message type.
 */
export const VIEW_LIMITED_KEY = "com.beeper.view_limited";

/** "View once": the only limit this client sends. Integers only, as event content may hold no floats. */
export const VIEW_ONCE: Readonly<ViewLimit> = Object.freeze({ type: "count", count: 1 });

const isViewOnce = (limit: ViewLimit | undefined): boolean =>
    !!limit && typeof limit === "object" && limit.type === "count" && limit.count === 1 && !limit.time;

/**
 * Whether the room's bridge takes this file as view-once media. False for rooms without a bridge that says
 * so - plain Matrix rooms included, where nothing could honour it.
 */
export function canSendViewOnce(room: Room | null | undefined, file: File): boolean {
    let msgtype: MsgType;
    if (file.type.startsWith("image/")) msgtype = MsgType.Image;
    else if (file.type.startsWith("video/")) msgtype = MsgType.Video;
    else return false;
    const limits = getRoomFeatures(room)?.file?.[msgtype]?.view_limited_types;
    return Array.isArray(limits) && limits.some(isViewOnce);
}

/** Whether a message was sent as view-once media. */
export function isViewOnceEvent(mxEvent: MatrixEvent): boolean {
    if (mxEvent.isRedacted()) return false;
    return isViewOnce(mxEvent.getOriginalContent()?.[VIEW_LIMITED_KEY]);
}
