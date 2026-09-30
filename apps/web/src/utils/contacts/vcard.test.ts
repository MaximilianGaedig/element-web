/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";

import { type ContactCard } from "./card";
import { parseVCards, toVCard, toVCards } from "./vcard";

/* A card written the way iOS writes one, including the bits that trip hand-rolled parsers. */
const APPLE = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "N:Kowalczyk;Aleksandra;Maria;Dr;PhD",
    "FN:Dr Aleksandra Maria Kowalczyk PhD",
    "NICKNAME:Ola",
    "ORG:Vector Ltd;Engineering",
    "TITLE:Engineer",
    "item1.TEL;type=CELL;type=VOICE;type=pref:+447700900123",
    "item1.X-ABLabel:_$!<Mobile>!$_",
    "item2.TEL;type=HOME:+442079460000",
    "item2.X-ABLabel:dad's landline",
    "EMAIL;type=INTERNET;type=WORK:ola@example.org",
    "ADR;type=HOME:;;12 Long Street;London;Greater London;SW1A 1AA;United Kingdom",
    "BDAY:1985-03-04",
    "NOTE:Met at the conference\\nSecond line",
    "END:VCARD",
].join("\r\n");

describe("reading vCards", () => {
    const [card] = parseVCards(APPLE);

    it("keeps the name in the parts N gives, not the one FN glued together", () => {
        expect(card.firstName).toBe("Aleksandra");
        expect(card.middleName).toBe("Maria");
        expect(card.lastName).toBe("Kowalczyk");
        expect(card.prefix).toBe("Dr");
        expect(card.suffix).toBe("PhD");
    });

    /*
     * The case this whole format exists for: a phone exports its own label as a separate X-ABLabel line
     * naming the group, so a parser that ignores groups keeps "CELL" and loses "dad's landline".
     */
    it("applies the custom labels that arrive as their own lines", () => {
        expect(card.phones).toEqual([
            { label: "mobile", value: "+447700900123" },
            { label: "dad's landline", value: "+442079460000" },
        ]);
    });

    it("drops the bookkeeping types that are not labels", () => {
        expect(card.emails).toEqual([{ label: "work", value: "ola@example.org" }]);
    });

    it("splits an address into the parts ADR defines", () => {
        expect(card.addresses).toEqual([
            {
                label: "home",
                street: "12 Long Street",
                city: "London",
                state: "Greater London",
                postcode: "SW1A 1AA",
                country: "United Kingdom",
            },
        ]);
    });

    it("unescapes what vCard escaped", () => {
        expect(card.notes).toBe("Met at the conference\nSecond line");
    });

    it("reads the organisation and the job", () => {
        expect(card.company).toBe("Vector Ltd");
        expect(card.department).toBe("Engineering");
        expect(card.jobTitle).toBe("Engineer");
    });
});

describe("reading awkward vCards", () => {
    it("unfolds the continuation lines long values are wrapped onto", () => {
        const folded = ["BEGIN:VCARD", "VERSION:4.0", "NOTE:This note is split", "  across two lines", "END:VCARD"];
        expect(parseVCards(folded.join("\r\n"))[0].notes).toBe("This note is split across two lines");
    });

    it("does not cut a line at a colon inside a quoted parameter", () => {
        const card = parseVCards(
            ["BEGIN:VCARD", "VERSION:4.0", 'URL;TYPE="see: here":https://example.org/a', "END:VCARD"].join("\r\n"),
        )[0];
        expect(card.urls?.[0].value).toBe("https://example.org/a");
    });

    it("reads the bare types vCard 2.1 wrote without an equals sign", () => {
        const card = parseVCards(["BEGIN:VCARD", "VERSION:2.1", "TEL;WORK:+15550100", "END:VCARD"].join("\r\n"))[0];
        expect(card.phones).toEqual([{ label: "work", value: "+15550100" }]);
    });

    it("reads every card in a file, which is how a whole address book arrives", () => {
        const two = APPLE + "\r\n" + ["BEGIN:VCARD", "VERSION:4.0", "FN:Bob", "END:VCARD"].join("\r\n");
        expect(parseVCards(two)).toHaveLength(2);
    });

    /* A truncated export is still mostly people; refusing the lot would be the wrong trade for the reader. */
    it("keeps a last card that was never closed", () => {
        expect(parseVCards(["BEGIN:VCARD", "VERSION:4.0", "FN:Half"].join("\r\n"))).toHaveLength(1);
    });

    it("takes a birthday however the exporter wrote it", () => {
        const of = (value: string): string | undefined =>
            parseVCards(["BEGIN:VCARD", `BDAY:${value}`, "END:VCARD"].join("\r\n"))[0].birthday;
        expect(of("19850304")).toBe("1985-03-04");
        expect(of("1985-03-04")).toBe("1985-03-04");
        // A day with no year, which is what a birthday often is.
        expect(of("--0304")).toBe("--03-04");
    });
});

describe("writing vCards", () => {
    const card: ContactCard = {
        firstName: "Ada",
        lastName: "Lovelace",
        nickname: "Ada",
        company: "Analytical Engines",
        phones: [{ label: "mobile", value: "+447700900123" }],
        emails: [{ label: "work", value: "ada@example.org" }],
        addresses: [{ label: "home", street: "1 Long Street", city: "London", country: "England" }],
        birthday: "--12-10",
        notes: "Semicolons; commas, and\nnewlines",
    };

    it("comes back as it went in", () => {
        const [back] = parseVCards(toVCard(card));
        expect(back.firstName).toBe("Ada");
        expect(back.lastName).toBe("Lovelace");
        expect(back.phones).toEqual(card.phones);
        expect(back.emails).toEqual(card.emails);
        expect(back.addresses).toEqual([{ ...card.addresses![0], state: undefined, postcode: undefined }]);
        expect(back.birthday).toBe("--12-10");
        expect(back.notes).toBe(card.notes);
    });

    it("escapes the characters that would otherwise be structure", () => {
        expect(toVCard(card)).toContain("NOTE:Semicolons\\; commas\\, and\\nnewlines");
    });

    it("folds the lines that are longer than the format allows", () => {
        const long = toVCard({ notes: "x".repeat(200) });
        for (const one of long.split("\r\n")) expect(one.length).toBeLessThanOrEqual(75);
        // And says the same thing when read back, which is the point of folding rather than truncating.
        expect(parseVCards(long)[0].notes).toBe("x".repeat(200));
    });

    /*
     * The fields that decide how a name sorts and is spoken. No standard property carries them, so both
     * Apple and Google use these X- ones - and a card that drops them cannot round-trip a contact from
     * either, which is most of the address books anyone would import here.
     */
    it("keeps the phonetic names and the previous one", () => {
        const [back] = parseVCards(
            toVCard({
                firstName: "Aiko",
                lastName: "Tanaka",
                phoneticFirst: "あいこ",
                phoneticMiddle: "x",
                phoneticLast: "たなか",
                previousName: "Sato",
            }),
        );
        expect(back.phoneticFirst).toBe("あいこ");
        expect(back.phoneticMiddle).toBe("x");
        expect(back.phoneticLast).toBe("たなか");
        expect(back.previousName).toBe("Sato");
    });

    it("keeps a dated value that is not an anniversary", () => {
        const [back] = parseVCards(toVCard({ dates: [{ label: "graduation", date: "2020-06-01" }] }));
        expect(back.dates).toEqual([{ label: "graduation", date: "2020-06-01" }]);
    });

    it("writes a file of several people", () => {
        const file = toVCards([card, { firstName: "Bob" }]);
        expect(parseVCards(file)).toHaveLength(2);
    });
});

/*
 * Everything, in and out, unchanged.
 *
 * The claim worth testing is not "it parses" but "nothing is lost": a card exported from here and read
 * back has to be the same card, field for field, or the export is a quiet way to destroy what the reader
 * typed. Every field the model has is filled in, and the result is compared whole rather than field by
 * field so that adding a field to the model without teaching vcard.ts about it fails here.
 */
describe("round-tripping everything", () => {
    const everything: ContactCard = {
        prefix: "Dr",
        firstName: "Aleksandra",
        phoneticFirst: "ah-lek-SAN-dra",
        middleName: "Maria",
        phoneticMiddle: "ma-REE-a",
        lastName: "Kowalczyk",
        phoneticLast: "ko-VAL-chik",
        suffix: "PhD",
        nickname: "Ola",
        previousName: "Nowak",
        jobTitle: "Engineer",
        department: "Engineering",
        company: "Vector Ltd",
        phones: [
            { label: "mobile", value: "+447700900123" },
            { label: "dad's landline", value: "+442079460000" },
        ],
        emails: [
            { label: "work", value: "ola@example.org" },
            { label: "school", value: "ola@example.edu" },
        ],
        urls: [{ label: "homepage", value: "https://example.org/ola" }],
        addresses: [
            {
                label: "home",
                street: "12 Long Street",
                city: "London",
                state: "Greater London",
                postcode: "SW1A 1AA",
                country: "United Kingdom",
            },
        ],
        birthday: "1985-03-04",
        dates: [
            { label: "anniversary", date: "2010-07-01" },
            { label: "graduation", date: "2007-06-15" },
        ],
        related: [
            { label: "spouse", name: "Jan" },
            { label: "mother", name: "Zofia" },
        ],
        social: [{ service: "mastodon", handle: "https://example.social/@ola", url: "https://example.social/@ola" }],
        messaging: [{ service: "skype", handle: "ola.k" }],
        notes: "Semicolons; commas, and\nnewlines",
    };

    it("gives back every field it was given", () => {
        const [back] = parseVCards(toVCard(everything));
        expect(back).toEqual(everything);
    });

    /*
     * A file from an address book with its own extensions is not ours to throw away: the properties this
     * does not understand are carried through untouched, so exporting a contact that came from elsewhere
     * does not quietly strip half of what its own app will look for.
     */
    it("carries through the properties it does not understand", () => {
        const odd = [
            "BEGIN:VCARD",
            "VERSION:4.0",
            "FN:Someone",
            "X-SOMETHING-ELSE:kept",
            "CATEGORIES:friends,work",
            "END:VCARD",
        ].join("\r\n");
        const out = toVCard(parseVCards(odd)[0]);
        expect(out).toContain("X-SOMETHING-ELSE:kept");
        expect(out).toContain("CATEGORIES:friends,work");
    });
});
