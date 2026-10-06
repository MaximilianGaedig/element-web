/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { canTranscribe, transcribe } from "./transcribe";

describe("transcribing a voice message", () => {
    const client = {
        getHomeserverUrl: () => "https://hs.example.org",
        getAccessToken: () => "secret-token",
        isRoomEncrypted: (roomId: string) => roomId === "!encrypted:example.org",
    } as unknown as MatrixClient;
    const fetchMock = vi.fn();

    beforeEach(() => {
        fetchMock.mockReset().mockResolvedValue(Response.json({ text: " Czekaj, muszę zapytać szefa. " }));
        vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => vi.unstubAllGlobals());

    it("sends the audio to the homeserver's transcriber as the signed-in user and returns the words", async () => {
        const audio = new Blob(["ogg"], { type: "audio/ogg" });

        expect(await transcribe(client, audio)).toBe("Czekaj, muszę zapytać szefa.");

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("https://hs.example.org/_mxg/transcribe");
        expect(init.method).toBe("POST");
        expect(init.headers).toEqual({ Authorization: "Bearer secret-token" });
        const body = init.body as FormData;
        expect(body.get("file")).toBeInstanceOf(Blob);
        expect(body.get("model")).toBe("deepdml/faster-whisper-large-v3-turbo-ct2");
    });

    it("gives nothing back for audio with no words in it", async () => {
        fetchMock.mockResolvedValue(Response.json({ text: "  " }));
        expect(await transcribe(client, new Blob(["ogg"]))).toBeUndefined();
    });

    it("says why when the server could not do it", async () => {
        fetchMock.mockResolvedValue(Response.json({ detail: "Failed to decode audio." }, { status: 415 }));
        await expect(transcribe(client, new Blob(["ogg"]))).rejects.toThrow("Failed to decode audio.");
    });

    it("falls back to the status when the server's answer is not a reason", async () => {
        fetchMock.mockResolvedValue(new Response("<html>", { status: 502 }));
        await expect(transcribe(client, new Blob(["ogg"]))).rejects.toThrow("HTTP 502");
    });

    it("does not send an encrypted room's audio anywhere", () => {
        expect(canTranscribe(client, "!plain:example.org")).toBe(true);
        expect(canTranscribe(client, "!encrypted:example.org")).toBe(false);
    });
});
