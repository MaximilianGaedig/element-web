/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type CSSProperties } from "react";
import { type MatrixEvent, MsgType } from "matrix-js-sdk/src/matrix";
import { type MediaEventContent } from "matrix-js-sdk/src/types";

import { mediaFromContent } from "../../customisations/Media";

/** Big enough that the sliver showing in the tail is not a blur, small enough to be cached already. */
const TAIL_THUMB = 96;

/**
 * The picture a bubble's tail should be filled with, handed down as a custom property to read.
 *
 * Telegram and iMessage treat a picture bubble as one silhouette: the photo runs into the tail,
 * rather than the tail being a coloured triangle stuck to the corner of it. A mask can only hide
 * part of an element and the tail hangs outside the picture's box, so the tail cannot be cut out of
 * the photo - it has to be painted with the photo instead.
 *
 * Encrypted media has no URL to hand: it is fetched and decrypted into a blob later, so those
 * bubbles keep the plain tail rather than flickering one in once the picture arrives.
 */
export function mediaTailStyle(event: MatrixEvent): CSSProperties | undefined {
    const content = event.getContent<MediaEventContent>();
    if (content.file || ![MsgType.Image, MsgType.Video].includes(content.msgtype)) return undefined;
    const media = mediaFromContent(content);
    const url = media.hasThumbnail
        ? media.getThumbnailHttp(TAIL_THUMB, TAIL_THUMB, "crop")
        : content.msgtype === MsgType.Image
          ? media.getThumbnailOfSourceHttp(TAIL_THUMB, TAIL_THUMB, "crop")
          : null;
    return url ? ({ "--tg-media-tail": `url("${url}")` } as CSSProperties) : undefined;
}
