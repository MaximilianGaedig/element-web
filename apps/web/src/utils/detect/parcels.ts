/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Parcel numbers, so "your parcel 630012345678901234567890" becomes the carrier's page.
 *
 * Two kinds, and they are treated differently on purpose. Some numbers say who they belong to by their
 * own shape - UPS begins 1Z, the post's international numbers end in the country, InPost is
 * twenty-four digits - and those can be read on sight. The rest are bare runs of digits that look like
 * every other number in a message, and are only taken when the carrier is named in the same message.
 *
 * Getting this wrong is not harmless: offering to track an order number, an invoice number or somebody's
 * account number is a link that leaks it to a carrier's website.
 */

export interface FoundParcel {
    text: string;
    start: number;
    end: number;
    carrier: string;
    url: string;
}

interface Carrier {
    name: string;
    /** How its numbers are written, where the shape is its own. */
    pattern?: RegExp;
    /** How a bare number is written, taken only when the carrier is named nearby. */
    bare?: RegExp;
    /** Words that name this carrier in a message. */
    words: RegExp;
    track: (number: string) => string;
}

const CARRIERS: Carrier[] = [
    {
        name: "InPost",
        // Twenty-four digits: nothing else in a message is that long.
        pattern: /\b\d{24}\b/g,
        words: /inpost|paczkomat|paczkomaty/i,
        track: (n) => `https://inpost.pl/sledzenie-przesylek?number=${n}`,
    },
    {
        name: "UPS",
        pattern: /\b1Z[0-9A-Z]{16}\b/g,
        words: /\bups\b/i,
        track: (n) => `https://www.ups.com/track?tracknum=${n}`,
    },
    {
        name: "DHL",
        // DHL Express air waybills, and the JJD/JVGL numbers its parcel arms use.
        pattern: /\b(?:JJD|JVGL)[0-9A-Z]{10,20}\b/g,
        bare: /\b\d{10,11}\b/g,
        words: /\bdhl\b/i,
        track: (n) => `https://www.dhl.com/pl-pl/home/tracking.html?tracking-id=${n}`,
    },
    {
        name: "Poczta Polska",
        // The universal postal form: two letters, nine digits, the country it was posted in.
        pattern: /\b[A-Z]{2}\d{9}(?:PL|DE|GB|US|CN)\b/g,
        words: /poczta|pocztex|priorytet/i,
        track: (n) => `https://emonitoring.poczta-polska.pl/?numer=${n}`,
    },
    {
        name: "DPD",
        bare: /\b\d{14}\b/g,
        words: /\bdpd\b/i,
        track: (n) => `https://tracktrace.dpd.com.pl/parcelDetails?p1=${n}`,
    },
    {
        name: "FedEx",
        bare: /\b(?:\d{12}|\d{15})\b/g,
        words: /fedex/i,
        track: (n) => `https://www.fedex.com/fedextrack/?trknbr=${n}`,
    },
    {
        name: "GLS",
        bare: /\b\d{11}\b/g,
        words: /\bgls\b/i,
        track: (n) => `https://gls-group.eu/PL/pl/sledzenie-paczek?match=${n}`,
    },
];

/** The parcels named in `text`: by their own shape, or by a bare number the message says the carrier of. */
export function detectParcels(text: string): FoundParcel[] {
    const found: FoundParcel[] = [];
    const add = (carrier: Carrier, match: RegExpExecArray | RegExpMatchArray): void => {
        const start = match.index ?? 0;
        const entry = {
            text: match[0],
            start,
            end: start + match[0].length,
            carrier: carrier.name,
            url: carrier.track(match[0]),
        };
        // One number belongs to one carrier: the first that recognised it, which is the one whose own
        // shape it matched, since those are looked at before the bare ones.
        if (!found.some((other) => entry.start < other.end && entry.end > other.start)) found.push(entry);
    };

    for (const carrier of CARRIERS) {
        if (!carrier.pattern) continue;
        carrier.pattern.lastIndex = 0;
        for (const match of text.matchAll(carrier.pattern)) add(carrier, match);
    }
    for (const carrier of CARRIERS) {
        if (!carrier.bare || !carrier.words.test(text)) continue;
        carrier.bare.lastIndex = 0;
        for (const match of text.matchAll(carrier.bare)) add(carrier, match);
    }
    return found.sort((a, b) => a.start - b.start);
}
