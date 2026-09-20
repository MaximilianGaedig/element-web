/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The text and photo rules of Telegram Web K's link preview box, ported from tweb (GPL-3.0,
 * https://github.com/morethanwords/tweb):
 *   src/helpers/string/limitSymbols.ts            the truncation itself
 *   src/components/wrappers/webPageTitle.ts       limitSymbols(title, 80, 100)
 *   src/components/wrappers/webPageDescription.ts limitSymbols(description, 150, 180)
 *   src/components/chat/bubbles.ts                messageMediaWebPage: square thumbnail or full preview
 */

import {
    WEBPAGE_DESCRIPTION_LIMIT,
    WEBPAGE_DESCRIPTION_LIMIT_FROM,
    WEBPAGE_TITLE_LIMIT,
    WEBPAGE_TITLE_LIMIT_FROM,
} from "./constants";

/**
 * tweb limitSymbols: trim, then cut to `length` and append an ellipsis, but only once the string is
 * longer than `limitFrom` - so a string that only just exceeds `length` is left whole rather than
 * traded for three dots.
 */
export function limitSymbols(str: string, length: number, limitFrom = length + 10): string {
    str = str.trim();
    return str.length > limitFrom ? str.slice(0, length) + "..." : str;
}

/** tweb wrapWebPageTitle. */
export function webPageTitle(title: string): string {
    return limitSymbols(title, WEBPAGE_TITLE_LIMIT, WEBPAGE_TITLE_LIMIT_FROM);
}

/** tweb wrapWebPageDescription. */
export function webPageDescription(description: string): string {
    return limitSymbols(description, WEBPAGE_DESCRIPTION_LIMIT, WEBPAGE_DESCRIPTION_LIMIT_FROM);
}

/**
 * Whether the photo is drawn as the small square thumbnail floated beside the text rather than as the
 * full-width preview under it.
 *
 * tweb: square when the photo is square (or its size is unknown) and there is text to float it beside,
 * else the full preview; `has_large_media` and `force_small_media`, which let a Telegram page override
 * the choice, have no equivalent in a Matrix preview. tweb also tags a portrait photo
 * `has-vertical-photo`, but nothing in its stylesheet reads that class, so it draws like any other
 * full preview and is not ported.
 */
export function isWebPageSquarePhoto(
    image: { width?: number; height?: number } | undefined,
    hasText: boolean,
): boolean {
    if (!hasText) return false;
    return !image?.width || !image.height || image.width === image.height;
}
