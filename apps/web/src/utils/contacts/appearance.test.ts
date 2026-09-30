/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it, vi } from "vitest";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { APPEARANCE_EVENT_TYPE, chosenColour, setColour } from "./appearance";
import { type Person } from "./people";

const person = (...mxids: string[]): Person =>
    ({
        id: "p",
        name: "Ada",
        accounts: mxids.map((mxid) => ({ network: "Signal", mxid, remoteId: mxid, keys: [] })),
        keys: [],
        rooms: [],
        saved: false,
        details: [],
    }) as unknown as Person;

const clientWith = (content: unknown): { client: MatrixClient; written: () => Record<string, unknown> | undefined } => {
    let written: Record<string, unknown> | undefined;
    const client = {
        getAccountData: () => (content === undefined ? undefined : { getContent: () => content }),
        setAccountData: vi.fn(async (_type: string, body: Record<string, unknown>) => {
            written = body;
        }),
    } as unknown as MatrixClient;
    return { client, written: () => written };
};

describe("contact appearance", () => {
    it("has nothing to say until a colour is chosen", () => {
        const { client } = clientWith(undefined);
        expect(chosenColour(client, person("@a:e"))).toBeUndefined();
    });

    /*
     * Against every account, not just the first: a person here is several of them, and a choice recorded
     * against one would be lost the moment the merge was rebuilt in a different order.
     */
    it("records the choice against all of their accounts", async () => {
        const { client, written } = clientWith({});
        await setColour(client, person("@tg:e", "@wa:e"), 3);
        expect(client.setAccountData).toHaveBeenCalledWith(APPEARANCE_EVENT_TYPE, expect.anything());
        expect(written()).toEqual({ colours: { "@tg:e": 3, "@wa:e": 3 } });
    });

    it("finds the choice through whichever account still carries it", () => {
        const { client } = clientWith({ colours: { "@wa:e": 5 } });
        expect(chosenColour(client, person("@tg:e", "@wa:e"))).toBe(5);
    });

    it("ignores a stored value that is not one of the colours", () => {
        const { client } = clientWith({ colours: { "@a:e": 99 } });
        expect(chosenColour(client, person("@a:e"))).toBeUndefined();
    });

    it("takes the choice away rather than storing a default", async () => {
        const { client, written } = clientWith({ colours: { "@a:e": 2, "@other:e": 4 } });
        await setColour(client, person("@a:e"), undefined);
        // Somebody else's choice is not disturbed by one person's being cleared.
        expect(written()).toEqual({ colours: { "@other:e": 4 } });
    });
});
