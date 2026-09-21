/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The small square cover Telegram puts beside a message it is quoting - tweb's `wrapReplyMedia`
 * (src/components/wrappers/reply.ts), used by the reply block and by the pinned-message plate.
 */

import { useEffect, useState } from "react";
import { type MatrixEvent, MsgType } from "matrix-js-sdk/src/matrix";

import { MediaEventHelper } from "../MediaEventHelper";

/** Whether the message is one Telegram shows a cover for: a photo, a video or a sticker. */
export function hasThumbnail(ev: MatrixEvent): boolean {
    const type = ev.getContent().msgtype;
    return ev.getType() === "m.sticker" || type === MsgType.Image || type === MsgType.Video;
}

/**
 * The cover's URL, or null while it loads and for a message that has none. The thumbnail is preferred
 * over the source, so a quote never downloads a full-size photo to draw forty pixels of it.
 */
export function useMediaThumbnail(ev: MatrixEvent | undefined): string | null {
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        setUrl(null);
        if (!ev || !hasThumbnail(ev)) return;
        let cancelled = false;
        const helper = new MediaEventHelper(ev);
        const load = async (): Promise<string | null> => {
            try {
                return (await helper.thumbnailUrl.value) ?? (await helper.sourceUrl.value);
            } catch {
                return null;
            }
        };
        void load().then((u) => {
            if (!cancelled) setUrl(u);
        });
        return () => {
            cancelled = true;
            helper.destroy();
        };
    }, [ev]);
    return url;
}
