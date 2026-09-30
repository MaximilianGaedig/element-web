/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it, vi } from "vitest";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { fetchBiography, readBiography } from "./biography";

describe("a bio from a profile (MSC4440)", () => {
    it("reads the plain representation of m.text", () => {
        expect(readBiography({ "m.text": [{ body: "I make things" }] })).toBe("I make things");
        expect(
            readBiography({
                "m.text": [
                    { mimetype: "text/html", body: "<b>I make</b> things" },
                    { mimetype: "text/plain", body: "I make things" },
                ],
            }),
        ).toBe("I make things");
    });

    it("has none when the field holds no text", () => {
        expect(readBiography(undefined)).toBeUndefined();
        expect(readBiography({ "m.text": [] })).toBeUndefined();
        expect(readBiography({ "m.text": [{ body: "  " }] })).toBeUndefined();
        expect(readBiography(42)).toBeUndefined();
    });

    it("asks the profile once and keeps the answer", async () => {
        const getExtendedProfile = vi.fn().mockResolvedValue({ "gay.fomx.biography": { "m.text": [{ body: "Hi" }] } });
        const client = { getExtendedProfile } as unknown as MatrixClient;
        expect(await fetchBiography(client, "@bio_once:e")).toBe("Hi");
        expect(await fetchBiography(client, "@bio_once:e")).toBe("Hi");
        expect(getExtendedProfile).toHaveBeenCalledTimes(1);
    });

    it("has no bio, not an error, when the profile cannot be read", async () => {
        const client = { getExtendedProfile: vi.fn().mockRejectedValue(new Error("403")) } as unknown as MatrixClient;
        expect(await fetchBiography(client, "@bio_hidden:e")).toBeUndefined();
        // ...and asks again next time, rather than keeping the failure.
        await fetchBiography(client, "@bio_hidden:e");
        expect(client.getExtendedProfile).toHaveBeenCalledTimes(2);
    });
});
