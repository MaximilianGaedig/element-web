/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The picture a chat-list preview is about, as Telegram puts one in front of "Photo".
 *
 * The last message's own photo or video if it has one; otherwise, if it replies to one that is loaded, that
 * one - "nice!" under somebody's photo is about the photo. Encrypted media has no thumbnail URL until it is
 * downloaded and decrypted, which is not worth doing for every row of the list, so it gets none.
 */

import { EventType, MsgType, type MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";
import { type MediaEventContent } from "matrix-js-sdk/src/types";

import { mediaFromContent } from "../../customisations/Media";

/** CSS pixels; the helper scales it for the screen. */
const SIZE = 18;

function hasPicture(event: MatrixEvent): boolean {
    if (event.isRedacted()) return false;
    if (event.getType() === EventType.Sticker) return true;
    const msgtype = event.getContent().msgtype;
    return msgtype === MsgType.Image || msgtype === MsgType.Video;
}

function thumbnailOf(event: MatrixEvent): string | undefined {
    const media = mediaFromContent(event.getContent<MediaEventContent>());
    if (media.isEncrypted) return undefined;
    // A video's own URL is the video; only its poster frame is a picture.
    if (event.getContent().msgtype === MsgType.Video && !media.hasThumbnail) return undefined;
    return media.getSquareThumbnailHttp(SIZE) ?? undefined;
}

export function previewThumbnail(event: MatrixEvent | undefined, room: Room): string | undefined {
    if (!event) return undefined;
    if (hasPicture(event)) return thumbnailOf(event);
    const repliedTo = event.replyEventId ? room.findEventById(event.replyEventId) : undefined;
    return repliedTo && hasPicture(repliedTo) ? thumbnailOf(repliedTo) : undefined;
}
