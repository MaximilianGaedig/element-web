/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * What a voice message said, in words, worked out by Groq's hosted whisper through the homeserver.
 *
 * The audio goes to the account's own server (`/_mxg/transcribe`), which checks the Matrix access token,
 * adds the Groq key it holds and passes the audio to Groq; the words come back. The key never reaches a
 * browser. Whisper large-v3-turbo does it because small and base misheard Polish badly enough to be worse
 * than nothing, and neither a phone, a laptop GPU nor the homeserver's CPU could run it in useful time
 * (minutes, minutes and fifty seconds for a six-second message). It decides the language itself, which
 * these chats - Polish, German and English by turns - need.
 *
 * Asked for, never automatic. What is worked out once is sent to the server (mediaText.ts), so nobody's
 * device ever asks twice - except in an encrypted room, where the words stay on this device (mediaText.ts
 * skips those rooms). The audio itself does go to Groq there too, because the person asked for it.
 */

import { type MatrixClient } from "matrix-js-sdk/src/matrix";

const PATH = "/_mxg/transcribe";

/** Groq's name for whisper large-v3-turbo. */
const MODEL = "whisper-large-v3-turbo";

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
