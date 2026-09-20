/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type Room } from "matrix-js-sdk/src/matrix";

import SettingsStore from "../../settings/SettingsStore";
import { ImageSize } from "../../settings/enums/ImageSize";
import UIStore from "../../stores/UIStore";
import { getBridgeBots, getBridgeInfo } from "../bridge/bridgeInfo";
import { BACKFILL_EVENT_TYPE } from "../chatHistory";

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
 * How many people are in the room, not counting the bridge's bot: it joins portals (a bridged DM has it as
 * a third member) to publish their state, and is no more a participant than the bridge itself.
 */
export function humanMemberCount(room: Room): number {
    const bots = getBridgeBots(room);
    for (const event of room.currentState.getStateEvents(BACKFILL_EVENT_TYPE)) {
        const sender = event.getSender();
        if (sender) bots.add(sender);
    }
    let count = room.getInvitedAndJoinedMemberCount();
    for (const bot of bots) {
        const membership = room.getMember(bot)?.membership;
        if (membership === "join" || membership === "invite") count--;
    }
    return count;
}

/**
 * Whether `room` is a one-to-one chat: at most two members, or a bridged DM (`com.beeper.room_type` dm).
 * Until a bridged room's bridge info is known, its bridge bot (which joins to publish the room's state) is
 * not counted as a member, so a DM is not taken for a group in the meantime.
 */
export function isOneToOneRoom(room: Room): boolean {
    const info = getBridgeInfo(room);
    if (!info) return humanMemberCount(room) <= 2;
    return room.getInvitedAndJoinedMemberCount() <= 2 || info.roomType === "dm";
}
