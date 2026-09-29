/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type CSSProperties } from "react";
import { type MatrixEvent, MsgType } from "matrix-js-sdk/src/matrix";
import { type MediaEventContent } from "matrix-js-sdk/src/types";

import { mediaFromContent } from "../../customisations/Media";
import { suggestedSize } from "../../settings/enums/ImageSize";
import { effectiveImageSize } from "./telegramLayout";

/** What to ask for where the event carries no dimensions to render the tail against. */
const TAIL_FALLBACK = 96;

/**
 * The picture a bubble's tail should be filled with, handed down as custom properties to read.
 *
 * Telegram and iMessage treat a picture bubble as one silhouette: the photo runs into the tail,
 * rather than the tail being a coloured triangle stuck to the corner of it. A mask can only hide
 * part of an element and the tail hangs outside the picture's box, so the tail cannot be cut out of
 * the photo - it has to be painted with the photo instead.
 *
 * For that to read as one picture rather than two, the tail has to show the pixels that continue
 * the corner it grows from, so it is given the same rendition the body shows - a video's frame, a
 * picture's own thumbnail - at the size the body is showing it at. The size travels alongside it,
 * because a background sized to the tail would squeeze the whole photo into an 11x20 box.
 *
 * Encrypted media has no URL to hand: it is fetched and decrypted into a blob later, so those
 * bubbles keep the plain tail rather than flickering one in once the picture arrives.
 */
export function mediaTailStyle(event: MatrixEvent): CSSProperties | undefined {
    const content = event.getContent<MediaEventContent>();
    const msgtype = content.msgtype as MsgType;
    if (content.file || ![MsgType.Image, MsgType.Video].includes(msgtype)) return undefined;

    // Only pictures and videos reach here, and only those carry dimensions.
    const info = content.info as { w?: number; h?: number } | undefined;
    const shown =
        info?.w && info?.h
            ? suggestedSize(effectiveImageSize(), { w: info.w, h: info.h })
            : { w: TAIL_FALLBACK, h: TAIL_FALLBACK };
    const w = Math.round(shown.w);
    const h = Math.round(shown.h);

    /*
     * Asked for as a legacy media URL, deliberately.
     *
     * The browser fetches a background image itself and has no access token to put on the request,
     * so the authenticated endpoint would refuse it. The service worker authenticates the legacy
     * path and rewrites it to the authenticated one on the way out (serviceworker/index.ts), which
     * is the only route a URL in a stylesheet can take.
     */
    const media = mediaFromContent(content);
    const url = media.hasThumbnail
        ? media.getThumbnailHttp(w, h, "scale", false)
        : msgtype === MsgType.Image
          ? media.getThumbnailOfSourceHttp(w, h, "scale", false)
          : null;
    if (!url) return undefined;

    return { "--tg-media-tail": `url("${url}")`, "--tg-media-tail-size": `${w}px ${h}px` } as CSSProperties;
}
