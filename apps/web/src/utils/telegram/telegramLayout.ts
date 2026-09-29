/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type Room } from "matrix-js-sdk/src/matrix";

import SettingsStore from "../../settings/SettingsStore";
import { ImageSize } from "../../settings/enums/ImageSize";
import { Layout } from "../../settings/enums/Layout";
import UIStore from "../../stores/UIStore";
import { getBridgeBots, getBridgeInfo } from "../bridge/bridgeInfo";
import { BACKFILL_EVENT_TYPE } from "../chatHistory";

/*
 * The messenger-style refinements, each asked about on its own.
 *
 * These were one switch, which made them one look to take or leave and left two layouts to keep
 * working. They are now separate changes to the app's own layout, so each has to stand up whether
 * or not the others are on — hence a function per concern rather than one "is it on" that
 * everything hangs off.
 */

/** Whether messages are drawn as bubbles, with the time and ticks inside them. */
export function bubbleTimelineEnabled(): boolean {
    return !!SettingsStore.getValue("bubbleTimeline");
}

/** Whether the timeline is held to a readable width, with a chat list that collapses beside it. */
export function chatColumnsEnabled(): boolean {
    return !!SettingsStore.getValue("chatColumns");
}

/** Whether the header, composer and scroll-down button float over the timeline. */
export function floatingBarsEnabled(): boolean {
    return !!SettingsStore.getValue("floatingBars");
}

/** Whether media is sized as the messengers size it, rather than by Element's image setting. */
export function compactMediaEnabled(): boolean {
    return !!SettingsStore.getValue("compactMedia");
}

/** Telegram Web's handheld breakpoint (helpers/mediaSizes.ts MOBILE_SIZE). */
const TELEGRAM_HANDHELD_MAX_WIDTH = 600;

/** The image size to lay media out with: the messengers' while messenger-sized media is on. */
export function effectiveImageSize(sticker = false): ImageSize {
    if (!compactMediaEnabled()) return SettingsStore.getValue("Images.size");
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
 * Whether messages carry Telegram's ticks.
 *
 * Load-bearing beyond decoration: the ticks are where a failed send shows itself ("error"), and the
 * Telegram layout suppresses Element's "some messages have not been sent" banner on the strength of
 * that. Both sides have to ask the same question or a failure shows nowhere at all - which is what
 * happened on the default settings, where readReceiptsStyle is "avatars" and a group chat therefore
 * had no ticks and no banner.
 *
 * Pure, and takes what it needs, so the timeline can pass its own reactive state and the status bar
 * can pass freshly read settings.
 */
export function telegramTicksShown({
    room,
    layout,
    bubbles,
    readReceiptsStyle,
}: {
    room: Room | null;
    layout: Layout | undefined;
    bubbles: boolean;
    readReceiptsStyle: string;
}): boolean {
    if (!room || !bubbles || layout !== Layout.Bubble) return false;
    return readReceiptsStyle === "ticks" || isOneToOneRoom(room);
}

/**
 * Whether `room` is a chat with one other person. A bridge that says what its portal is (`com.beeper
 * .room_type`) is believed: its DM is one even though the bridge's bot is in the room as well, and its
 * group is not one even when only two people are in it. Otherwise the members are counted, without the
 * bots.
 */
export function isOneToOneRoom(room: Room): boolean {
    const info = getBridgeInfo(room);
    if (info) return info.roomType === "dm";
    return humanMemberCount(room) <= 2;
}
