/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * What media said, shared with the server so it is searchable and only ever read once.
 *
 * A device reads a picture because it has it on screen anyway, and that reading is the same on every
 * device - so it is sent up (`im.mxg.media_text`), where the server indexes it as if it were the
 * message's own words. Search then finds the receipt, the screenshot of an address, the poster, with no
 * change to search itself, from a laptop that never opened that picture.
 *
 * What is sent is text the device already has, to the account's own server, and to a room that server
 * can read anyway: an encrypted room's media is never read here, since its text would be handing the
 * server what encryption was for. The whole thing is skipped where the server does not offer it.
 */

import { type MatrixClient, Method } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";
import * as utils from "matrix-js-sdk/src/utils";

const FEATURE = "im.mxg.media_text";
const PREFIX = "/_matrix/client/unstable/im.mxg.media_text";

/** Where a piece of text came from, as the server names them. */
export type TextKind = "ocr" | "transcript" | "description";

interface StoredText {
    kind: TextKind;
    text: string;
}

/** Asked once per session: whether this server keeps what media says. */
let supported: Promise<boolean> | undefined;

function serverKeepsText(client: MatrixClient): Promise<boolean> {
    supported ??= client.doesServerSupportUnstableFeature(FEATURE).catch(() => false);
    return supported;
}

/** Whether this room's media may be read into the server's index at all. */
async function indexable(client: MatrixClient, roomId: string): Promise<boolean> {
    return !client.isRoomEncrypted(roomId) && (await serverKeepsText(client));
}

const path = (roomId: string, eventId: string): string =>
    utils.encodeUri("/rooms/$roomId/$eventId", { $roomId: roomId, $eventId: eventId });

/**
 * What the server already knows this event's media says, or nothing.
 *
 * Worth asking before reading anything: a picture read on a phone needs no reading on a laptop, and
 * this is one small request against several megabytes of engine and a second of work.
 */
export async function storedMediaText(
    client: MatrixClient,
    roomId: string,
    eventId: string,
): Promise<Partial<Record<TextKind, string>> | undefined> {
    if (!(await indexable(client, roomId))) return undefined;
    try {
        const response = await client.http.authedRequest<{ texts: StoredText[] }>(
            Method.Get,
            path(roomId, eventId),
            undefined,
            undefined,
            { prefix: PREFIX },
        );
        if (!response.texts.length) return undefined;
        return Object.fromEntries(response.texts.map(({ kind, text }) => [kind, text]));
    } catch {
        // Nothing stored, or a server that cannot say: either way there is nothing to go on.
        return undefined;
    }
}

/**
 * Tells the server what this event's media says, so every device can find it.
 *
 * Empty text is sent as well as full: "this picture says nothing" is worth knowing, and is what stops
 * every device reading a photograph of a dog over and over.
 */
export async function saveMediaText(
    client: MatrixClient,
    roomId: string,
    eventId: string,
    kind: TextKind,
    text: string,
): Promise<void> {
    if (!(await indexable(client, roomId))) return;
    try {
        await client.http.authedRequest(
            Method.Post,
            path(roomId, eventId),
            undefined,
            { kind, text },
            {
                prefix: PREFIX,
            },
        );
    } catch (error) {
        // A reading nobody else will see is a wasted second, not a broken chat.
        logger.warn("Could not store what a picture said", error);
    }
}
