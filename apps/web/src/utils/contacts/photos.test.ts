/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it, vi } from "vitest";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { inlinePhotoOf, photosToMedia, vCardWithPhoto, vCardsWithPhotos } from "./photos";
import { parseVCards } from "./vcard";

vi.mock("../../customisations/Media", () => ({
    mediaFromMxc: (url: string) => ({
        downloadSource: async () => {
            if (url !== "mxc://e/ada") throw new Error("not found");
            return new Response(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" }));
        },
    }),
}));

describe("inline pictures in vCards", () => {
    it("reads vCard 3's base64 PHOTO, with and without a group or a type", () => {
        expect(inlinePhotoOf("PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQ")).toEqual({
            type: "image/jpeg",
            base64: "/9j/4AAQ",
        });
        expect(inlinePhotoOf("item1.PHOTO;ENCODING=b:iVBORw0K")).toEqual({ type: "image/png", base64: "iVBORw0K" });
    });

    it("reads vCard 4's data URI", () => {
        expect(inlinePhotoOf("PHOTO:data:image/png;base64,iVBORw0K")).toEqual({
            type: "image/png",
            base64: "iVBORw0K",
        });
    });

    it("leaves a PHOTO that is a link, and every other property, alone", () => {
        expect(inlinePhotoOf("PHOTO;VALUE=uri:https://example.org/a.jpg")).toBeUndefined();
        expect(inlinePhotoOf("X-ABADR:pl")).toBeUndefined();
    });

    it("keeps a picture the reader chose over the one a file brings", async () => {
        const client = { uploadContent: vi.fn() } as unknown as MatrixClient;
        const card = await photosToMedia(client, { photoUrl: "mxc://e/mine", extra: ["PHOTO;ENCODING=b:/9j/AA"] });
        expect(card).toEqual({ photoUrl: "mxc://e/mine" });
        expect(client.uploadContent).not.toHaveBeenCalled();
    });
});

describe("exporting a card with its picture", () => {
    it("puts the picture itself in the vCard, which another address book can read back", async () => {
        const text = await vCardWithPhoto({} as MatrixClient, { firstName: "Ada", photoUrl: "mxc://e/ada" });
        expect(text).toContain("PHOTO;ENCODING=b;TYPE=JPEG:/9j/4A==");
        // And the round trip finds it as a picture, ready to go to media again.
        const [card] = parseVCards(text);
        expect(inlinePhotoOf(card.extra![0])).toEqual({ type: "image/jpeg", base64: "/9j/4A==" });
    });

    it("exports the card without a picture it cannot fetch", async () => {
        const text = await vCardWithPhoto({} as MatrixClient, { firstName: "Bob", photoUrl: "mxc://e/gone" });
        expect(text).not.toContain("PHOTO");
    });

    it("writes a file of several people", async () => {
        const file = await vCardsWithPhotos({} as MatrixClient, [{ firstName: "Ada" }, { firstName: "Bob" }]);
        expect(parseVCards(file)).toHaveLength(2);
    });
});
