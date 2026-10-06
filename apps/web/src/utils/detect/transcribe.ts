/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * What a voice message said, in words, worked out by the homeserver's own whisper.
 *
 * The audio goes to the account's own server (`/_mxg/transcribe`, which hands it to a whisper container
 * after checking the Matrix access token) and the words come back. Nothing leaves the account's own
 * infrastructure and no other key is involved. Whisper large-v3-turbo runs there because small and base
 * misheard Polish badly enough to be worse than nothing, and a phone or laptop cannot run it: it took
 * minutes on a laptop GPU. It decides the language itself, which these chats - Polish, German and English
 * by turns - need.
 *
 * Asked for, never automatic. What is worked out once is sent to the server (mediaText.ts), so nobody's
 * device ever asks twice. A room that is encrypted is never sent: the server could not read that audio,
 * and handing it over would undo what encryption was for.
 */

import { type MatrixClient } from "matrix-js-sdk/src/matrix";

const PATH = "/_mxg/transcribe";

/** The model the server's whisper loads; the server downloads it the first time it is asked for. */
const MODEL = "deepdml/faster-whisper-large-v3-turbo-ct2";

/**
 * Whether this room's voice messages may be sent to the server to be transcribed. An encrypted room's
 * audio is not, and a server that has no transcriber answers 404 (see {@link transcribe}).
 */
export function canTranscribe(client: MatrixClient, roomId: string): boolean {
    return !client.isRoomEncrypted(roomId);
}

/**
 * What was said in a piece of audio, or nothing where there were no words in it.
 *
 * Throws where the server could not do it (not signed in, no transcriber there, whisper failed), with the
 * server's reason, so the person asking can be told rather than left looking at a spinner.
 */
export async function transcribe(client: MatrixClient, audio: Blob): Promise<string | undefined> {
    const body = new FormData();
    body.append("file", audio, "voice-message");
    body.append("model", MODEL);
    body.append("response_format", "json");

    const response = await fetch(client.getHomeserverUrl() + PATH, {
        method: "POST",
        headers: { Authorization: `Bearer ${client.getAccessToken()}` },
        body,
    });
    if (!response.ok) {
        const reason = await response.json().then(
            (error: { detail?: unknown }) => (typeof error.detail === "string" ? error.detail : undefined),
            () => undefined,
        );
        throw new Error(reason ?? `HTTP ${response.status}`);
    }
    const { text } = (await response.json()) as { text?: string };
    return text?.trim() || undefined;
}
