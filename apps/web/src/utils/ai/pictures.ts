/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The pictures themselves, for a question the words cannot answer.
 *
 * Text read out of a picture already travels as part of the chat (utils/ai/readable.ts), because a device
 * with the picture on screen reads it anyway. This is the other half: "which of these is the receipt",
 * "what does the sign say", "is that the right door" - questions no reading of the text can settle.
 *
 * Kept deliberately small: the newest few, shrunk, and only for a question that was actually asked - a
 * summary is not worth uploading a chat's photographs for. A picture whose text has already been read
 * still goes, because reading the text is not seeing the picture: what is behind the sign, which of the
 * three receipts is the right one, whether the door is the blue one. The ones nobody has read go first,
 * since the transcript already carries what the others say.
 */

import { type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";

import { MediaEventHelper } from "../MediaEventHelper";
import { storedMediaText } from "../detect/mediaText";

/** How many, and how big each may be once shrunk. */
const MOST = 3;
const SIDE = 900;
const QUALITY = 0.7;

/** How far back a question looks for something to see. */
const WITHIN = 40;

/** Shrunk to something a model can read, as a data url. */
async function shrink(blob: Blob): Promise<string | undefined> {
    const bitmap = await createImageBitmap(blob).catch(() => undefined);
    if (!bitmap) return undefined;
    try {
        const scale = Math.min(1, SIDE / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext("2d");
        if (!context) return undefined;
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/jpeg", QUALITY);
    } finally {
        bitmap.close();
    }
}

/**
 * The newest pictures of a chat, ready to be looked at.
 *
 * Through MediaEventHelper rather than the plain URL, because media needs the access token and an
 * encrypted room's pictures need decrypting - a bare fetch gets a 401 or a blob of ciphertext. One that
 * will not load is left out rather than failing the question.
 */
export async function picturesFor(client: MatrixClient, room: Room): Promise<string[]> {
    const pictures = room
        .getLiveTimeline()
        .getEvents()
        .slice(-WITHIN)
        .filter((event: MatrixEvent) => event.getContent().msgtype === "m.image" && !event.isRedacted());

    // What has been read is already in the transcript as words; only what nobody has read is worth sending.
    const read = await Promise.all(
        pictures.map((event) => storedMediaText(client, event.getRoomId()!, event.getId()!).catch(() => undefined)),
    );
    const events = pictures.filter((_, at) => !read[at]?.ocr && !read[at]?.description).slice(-MOST);

    const loaded = await Promise.all(
        events.map(async (event) => {
            try {
                const blob = await new MediaEventHelper(event).sourceBlob.value;
                return await shrink(blob);
            } catch {
                // A picture that will not load is one fewer picture, not a failed question.
                return undefined;
            }
        }),
    );
    return loaded.filter((url): url is string => !!url);
}
