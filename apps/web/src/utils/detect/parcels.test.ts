/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";

import { detectParcels } from "./parcels";

describe("detectParcels", () => {
    it("reads the numbers that say whose they are", () => {
        expect(detectParcels("paczka 630012345678901234567890 w drodze")[0]).toMatchObject({
            carrier: "InPost",
            text: "630012345678901234567890",
        });
        expect(detectParcels("tracking 1Z999AA10123456784")[0]).toMatchObject({ carrier: "UPS" });
        expect(detectParcels("list RR123456785PL nadany")[0]).toMatchObject({ carrier: "Poczta Polska" });
        expect(detectParcels("JJD000390007312345678")[0]).toMatchObject({ carrier: "DHL" });
    });

    it("reads a bare number only when the message says the carrier", () => {
        expect(detectParcels("DHL: 1234567890")[0]).toMatchObject({ carrier: "DHL", text: "1234567890" });
        // The same number with nothing to say what it is: an order number, a phone number, anything.
        expect(detectParcels("zamówienie 1234567890")).toEqual([]);
    });

    it("does not offer to track an invoice or an account number", () => {
        expect(detectParcels("faktura 12345678901234 na kwotę 300 zł")).toEqual([]);
        expect(detectParcels("konto 61109010140000071219812874")).toEqual([]);
    });

    it("links to the carrier's own page", () => {
        expect(detectParcels("1Z999AA10123456784")[0].url).toBe(
            "https://www.ups.com/track?tracknum=1Z999AA10123456784",
        );
    });

    it("gives one number to one carrier", () => {
        // Twenty-four digits is InPost's shape and also contains DHL's ten-digit one.
        const found = detectParcels("dhl inpost 630012345678901234567890");
        expect(found).toHaveLength(1);
        expect(found[0].carrier).toBe("InPost");
    });
});
