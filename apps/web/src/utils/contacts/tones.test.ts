/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it, vi } from "vitest";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { RINGTONE_EVENT_TYPE, ringtoneFor, ringtoneOf, setRingtone } from "./tones";
import { type Person } from "./people";

const person = (...rooms: string[]): Person =>
    ({ id: "p", name: "Ada", accounts: [], keys: [], rooms, saved: false, details: [] }) as unknown as Person;

const clientWith = (tones: Record<string, unknown>): { client: MatrixClient; written: [string, string, unknown][] } => {
    const written: [string, string, unknown][] = [];
    const client = {
        getRoom: (roomId: string) =>
            tones[roomId] === undefined ? null : { getAccountData: () => ({ getContent: () => tones[roomId] }) },
        setRoomAccountData: vi.fn(async (roomId: string, type: string, content: unknown) => {
            written.push([roomId, type, content]);
        }),
    } as unknown as MatrixClient;
    return { client, written };
};

describe("a person's ringtone", () => {
    it("is read from the room it was set on", () => {
        const { client } = clientWith({ "!a:e": { url: "mxc://e/tone", name: "Chimes" } });
        expect(ringtoneFor(client, "!a:e")).toEqual({ url: "mxc://e/tone", name: "Chimes" });
    });

    /*
     * The whole point of a merged contact: somebody reachable on three networks is one person, so they ring
     * the same whichever of them they call on rather than only on the chat the tone happened to be set from.
     */
    it("is set on every chat with them", async () => {
        const { client, written } = clientWith({});
        await setRingtone(client, person("!tg:e", "!wa:e", "!sig:e"), { url: "mxc://e/tone", name: "Chimes" });
        expect(written.map(([roomId]) => roomId)).toEqual(["!tg:e", "!wa:e", "!sig:e"]);
        expect(written.every(([, type]) => type === RINGTONE_EVENT_TYPE)).toBe(true);
    });

    it("is found through whichever of their chats still carries it", () => {
        const { client } = clientWith({ "!wa:e": { url: "mxc://e/tone" } });
        expect(ringtoneOf(client, person("!tg:e", "!wa:e"))?.url).toBe("mxc://e/tone");
    });

    /* Anything that is not media in the reader's own repository is not something to try to play. */
    it("ignores a stored value that is not an mxc URI", () => {
        const { client } = clientWith({ "!a:e": { url: "https://example.org/tone.mp3" } });
        expect(ringtoneFor(client, "!a:e")).toBeUndefined();
    });

    it("clears back to the default rather than storing an empty name", async () => {
        const { client, written } = clientWith({ "!a:e": { url: "mxc://e/tone" } });
        await setRingtone(client, person("!a:e"), undefined);
        expect(written).toEqual([["!a:e", RINGTONE_EVENT_TYPE, {}]]);
    });
});
