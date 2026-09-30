/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it, vi } from "vitest";
import { type MatrixClient, MatrixError } from "matrix-js-sdk/src/matrix";

import { discoverOnMatrix, lookupQuery } from "./discover";

vi.mock("../../IdentityAuthClient", () => ({
    default: class {
        public async getAccessToken(): Promise<string> {
            return "token";
        }
    },
}));

const clientWith = (
    result: unknown,
    { server = "https://ident.example" }: { server?: string | null } = {},
): MatrixClient =>
    ({
        getIdentityServerUrl: () => server,
        getSafeUserId: () => "@me:e",
        bulkLookupThreePids: vi.fn(async () => {
            if (result instanceof Error) throw result;
            return result;
        }),
    }) as unknown as MatrixClient;

describe("what to look up", () => {
    /*
     * The same person stored as "+44 7700 900123" in one card and "07700900123" in another is one number,
     * and only one of those strings is findable - so this is where they are made the same.
     */
    it("puts numbers into the form the lookup takes", () => {
        expect(lookupQuery({ phones: [{ label: "mobile", value: "+44 7700 900123" }] })).toEqual([
            ["msisdn", "447700900123"],
        ]);
    });

    it("lower-cases addresses, which are not case sensitive", () => {
        expect(lookupQuery({ emails: [{ label: "home", value: " Ada@Example.ORG " }] })).toEqual([
            ["email", "ada@example.org"],
        ]);
    });

    it("leaves out what could not be looked up anyway", () => {
        expect(
            lookupQuery({ phones: [{ label: "mobile", value: "123" }], emails: [{ label: "home", value: "nope" }] }),
        ).toEqual([]);
    });
});

describe("finding contacts on Matrix", () => {
    it("asks once for a number that is in two cards", async () => {
        const client = clientWith({ threepids: [] });
        const result = await discoverOnMatrix(client, [
            { phones: [{ label: "mobile", value: "+447700900123" }] },
            { phones: [{ label: "work", value: "+44 7700 900123" }] },
        ]);
        expect(result.asked).toBe(1);
    });

    it("says who was found, and by what", async () => {
        const client = clientWith({ threepids: [["msisdn", "447700900123", "@ada:e"]] });
        const result = await discoverOnMatrix(client, [{ phones: [{ label: "mobile", value: "+447700900123" }] }]);
        expect(result.found).toEqual([{ medium: "msisdn", address: "447700900123", mxid: "@ada:e" }]);
    });

    it("does not count finding yourself as finding a contact", async () => {
        const client = clientWith({ threepids: [["email", "me@example.org", "@me:e"]] });
        const result = await discoverOnMatrix(client, [{ emails: [{ label: "home", value: "me@example.org" }] }]);
        expect(result.found).toEqual([]);
    });

    /*
     * These are answers the screen has to show, not errors to swallow: a rejected promise would turn "you
     * have no identity server" and "the server wants you to agree to its terms" into the same empty list.
     */
    it("says when there is no identity server rather than looking like nobody was found", async () => {
        const result = await discoverOnMatrix(clientWith({ threepids: [] }, { server: null }), [
            { emails: [{ label: "home", value: "ada@example.org" }] },
        ]);
        expect(result.problem).toBe("no-server");
    });

    it("says when the server wants its terms agreed", async () => {
        const client = clientWith(new MatrixError({ errcode: "M_TERMS_NOT_SIGNED", error: "nope" }));
        const result = await discoverOnMatrix(client, [{ emails: [{ label: "home", value: "ada@example.org" }] }]);
        expect(result.problem).toBe("terms");
    });

    /* Nothing to look up means nothing is sent, and no server is contacted at all. */
    it("sends nothing when there is nothing to send", async () => {
        const client = clientWith({ threepids: [] });
        const result = await discoverOnMatrix(client, [{ firstName: "Ada" }]);
        expect(result).toEqual({ found: [], asked: 0 });
        expect(client.bulkLookupThreePids).not.toHaveBeenCalled();
    });
});
