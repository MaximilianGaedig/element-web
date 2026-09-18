/*
Copyright 2024 New Vector Ltd.
Copyright 2021 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// For Large the image gets drawn as big as possible.
// constraint by: timeline width, manual height overrides, SIZE_LARGE.h
const SIZE_LARGE = { w: 800, h: 600 };
// For Normal the image gets drawn to never exceed SIZE_NORMAL.w, SIZE_NORMAL.h
// constraint by: timeline width, manual height overrides
const SIZE_NORMAL_LANDSCAPE = { w: 324, h: 324 }; // for w > h
const SIZE_NORMAL_PORTRAIT = { w: Math.ceil(324 * (9 / 16)), h: 324 }; // for h > w

// Telegram-style layout: Telegram Web's media boxes (Telegram Web K helpers/mediaSizes.ts, GPL-3.0):
// "regular" 420x400 on desktop / 340x340 on handhelds, stickers 200x200 / 180x180.
const SIZE_TELEGRAM = { w: 420, h: 400 };
const SIZE_TELEGRAM_HANDHELD = { w: 340, h: 340 };
const SIZE_TELEGRAM_STICKER = { w: 200, h: 200 };
const SIZE_TELEGRAM_STICKER_HANDHELD = { w: 180, h: 180 };

type Dimensions = { w?: number; h?: number };

export enum ImageSize {
    Normal = "normal",
    Large = "large",
    /** Not user-selectable: used instead of the setting while the Telegram-style layout is on. */
    Telegram = "telegram",
    /** Not user-selectable: Telegram-style layout on a narrow (handheld) window. */
    TelegramHandheld = "telegram_handheld",
    /** Not user-selectable: stickers in the Telegram-style layout. */
    TelegramSticker = "telegram_sticker",
    /** Not user-selectable: stickers in the Telegram-style layout on a narrow (handheld) window. */
    TelegramStickerHandheld = "telegram_sticker_handheld",
}

function maxSizeFor(size: ImageSize, portrait: boolean): Required<Dimensions> {
    switch (size) {
        case ImageSize.Large:
            return SIZE_LARGE;
        case ImageSize.Telegram:
            return SIZE_TELEGRAM;
        case ImageSize.TelegramHandheld:
            return SIZE_TELEGRAM_HANDHELD;
        case ImageSize.TelegramSticker:
            return SIZE_TELEGRAM_STICKER;
        case ImageSize.TelegramStickerHandheld:
            return SIZE_TELEGRAM_STICKER_HANDHELD;
        default:
            return portrait ? SIZE_NORMAL_PORTRAIT : SIZE_NORMAL_LANDSCAPE;
    }
}

/**
 * @param {ImageSize} size The user's image size preference
 * @param {Dimensions} contentSize The natural dimensions of the content
 * @param {number} maxHeight Overrides the default height limit
 * @returns {Dimensions} The suggested maximum dimensions for the image
 */
export function suggestedSize(size: ImageSize, contentSize: Dimensions, maxHeight?: number): Required<Dimensions> {
    const aspectRatio = contentSize.w! / contentSize.h!;
    const portrait = aspectRatio < 1;

    const maxSize = maxSizeFor(size, portrait);
    if (!contentSize.w || !contentSize.h) {
        return maxSize;
    }

    const constrainedSize = {
        w: Math.min(maxSize.w, contentSize.w),
        h: maxHeight ? Math.min(maxSize.h, contentSize.h, maxHeight) : Math.min(maxSize.h, contentSize.h),
    };

    if (constrainedSize.h * aspectRatio < constrainedSize.w) {
        // Height dictates width
        return { w: Math.floor(constrainedSize.h * aspectRatio), h: constrainedSize.h };
    } else {
        // Width dictates height
        return { w: constrainedSize.w, h: Math.floor(constrainedSize.w / aspectRatio) };
    }
}
