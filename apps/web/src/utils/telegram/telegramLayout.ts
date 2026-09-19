/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type Room } from "matrix-js-sdk/src/matrix";

import SettingsStore from "../../settings/SettingsStore";
import { ImageSize } from "../../settings/enums/ImageSize";
import UIStore from "../../stores/UIStore";
import { getBridgeInfo } from "../bridge/bridgeInfo";

/** Whether the Telegram-style layout (narrow timeline, Telegram media sizes, compact bubbles) is on. */
export function isTelegramLayout(): boolean {
    return !!SettingsStore.getValue("telegramStyleLayout");
}

/** Telegram Web's handheld breakpoint (helpers/mediaSizes.ts MOBILE_SIZE). */
const TELEGRAM_HANDHELD_MAX_WIDTH = 600;

/** The image size to lay media out with: Telegram's while the Telegram-style layout is on. */
export function effectiveImageSize(sticker = false): ImageSize {
    if (!isTelegramLayout()) return SettingsStore.getValue("Images.size");
    const handheld = UIStore.instance.windowWidth <= TELEGRAM_HANDHELD_MAX_WIDTH;
    if (sticker) return handheld ? ImageSize.TelegramStickerHandheld : ImageSize.TelegramSticker;
    return handheld ? ImageSize.TelegramHandheld : ImageSize.Telegram;
}

/**
 * Whether `room` is a one-to-one chat: at most two members, or a bridged DM (`com.beeper.room_type`
 * dm), whose portal also contains the bridge bot.
 */
export function isOneToOneRoom(room: Room): boolean {
    return room.getInvitedAndJoinedMemberCount() <= 2 || getBridgeInfo(room)?.roomType === "dm";
}
