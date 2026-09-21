/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Places, in the way people write them to each other: "ul. Marszałkowska 12", "Hauptstraße 5",
 * "123 Main Street", "10 rue de Rivoli, 75001 Paris".
 *
 * Unlike links, numbers and times, this has no library: the one program that reads addresses in every
 * language, libpostal, is a C library with a two-gigabyte model behind it and has no browser build. So
 * what is read here is the *shape* an address is written in, of which there are three in the languages
 * people write here, and the words that mark one - which is a table, the way chronoPl.ts is a table.
 *
 * The rule is the same as everywhere else in this folder: a wrong answer is worse than none. A street
 * word and a house number have to both be there, so "on Main Street" and "12 of them" are left alone,
 * and a postcode and town are taken in only when they follow the street, where they can only be part of
 * it.
 */

/** Something that reads as a place, and the span it was written in. */
export interface FoundAddress {
    text: string;
    start: number;
    end: number;
}

/**
 * Words that mark a street where they come *before* its name, with the abbreviations they are written
 * as. Polish, Czech and the Romance languages put them here.
 */
const LEADING = [
    // Polish
    "ul",
    "ulica",
    "ulicy",
    "al",
    "aleja",
    "aleje",
    "pl",
    "plac",
    "os",
    "osiedle",
    // Czech, Slovak
    "nám",
    "náměstí",
    // French
    "rue",
    "avenue",
    "av",
    "boulevard",
    "bd",
    "impasse",
    "place",
    "chemin",
    "quai",
    // Italian
    "via",
    "viale",
    "corso",
    "piazza",
    "vicolo",
    // Spanish, Portuguese, Catalan
    "calle",
    "avenida",
    "avda",
    "paseo",
    "carrer",
    "plaça",
    "praça",
    "rua",
];

/**
 * Endings that mark a street where they are stuck onto the *end* of its name, which is how German, the
 * Low German languages and the Nordic ones write one: Hauptstraße, Kerkstraat, Storgatan.
 */
const TRAILING = [
    // German
    "straße",
    "strasse",
    "str",
    "gasse",
    "weg",
    "allee",
    "platz",
    "ring",
    "damm",
    "ufer",
    "chaussee",
    // Dutch
    "straat",
    "laan",
    "gracht",
    "plein",
    "dijk",
    // Nordic
    "gata",
    "gatan",
    "gate",
    "gaten",
    "vägen",
    "vagen",
    "vej",
    "vei",
    "katu",
    "tie",
];

/** Words that mark a street where they come after its name and apart from it, as English writes one. */
const ENGLISH = [
    "street",
    "st",
    "avenue",
    "ave",
    "road",
    "rd",
    "boulevard",
    "blvd",
    "lane",
    "ln",
    "drive",
    "dr",
    "way",
    "court",
    "ct",
    "place",
    "pl",
    "square",
    "sq",
    "terrace",
    "close",
];

/**
 * The words, longest first so the longer spelling wins, and either way up in their first letter -
 * "Rue" and "rue" are both written. Matching case-insensitively instead would be simpler and wrong: the
 * patterns below tell a street's name from an ordinary word by its capital letter, and a case-insensitive
 * regex has no capital letters in it, which turned "3 of the way" into an address.
 */
const longestFirst = (words: string[]): string =>
    [...words]
        .sort((a, b) => b.length - a.length)
        .map((word) => `[${word[0].toUpperCase()}${word[0]}]${word.slice(1)}`)
        .join("|");

/** A house number: 12, 12a, 12/4, 12-14, and the flat after it. */
const NUMBER = String.raw`\d{1,4}[a-zA-Z]?(?:\s?[/-]\s?\d{1,4}[a-zA-Z]?)?`;

/** A street's or town's own name: up to three capitalised words, which is what one is called. */
const NAME = String.raw`\p{Lu}[\p{L}'’-]+(?:\s+(?:\p{Ll}{1,3}\s+)?\p{Lu}[\p{L}'’-]+){0,2}`;

/**
 * A name as it follows a street word, which is the one place a little word may come first: "rue *de*
 * Rivoli", "plac *na* Rozdrożu". Allowing that anywhere would let a name swallow the word before it -
 * "wpadnij *na* Morska 1" - and let one address swallow the next.
 */
const STREET = String.raw`(?:\p{Ll}{1,3}\s+)?${NAME}`;

/** How a street word is written off from its name: "ul.", "C/", or just a space. */
const AFTER_WORD = String.raw`[./]?\s+`;

/**
 * A postcode and the town after it, where they follow the street - the only place they can be read
 * without guessing. The shapes are the ones written in the countries these languages are written in:
 * 00-950 Warszawa, 10115 Berlin, 75001 Paris, SW1A 1AA London, 1011 AB Amsterdam, CA 90210.
 */
const POSTCODE = String.raw`(?:\d{2}-\d{3}|\d{4}\s?[A-Z]{2}|\d{4,6}|[A-Z]{1,2}\d[\dA-Z]?\s?\d[A-Z]{2}|[A-Z]{2}\s?\d{5})`;

/**
 * The town is only taken in when the address ends there - at the end of the message or at its
 * punctuation - so that "ul. Krótka 1 zapraszam wszystkich" does not read the next word as a town.
 */
const LOCALITY = new RegExp(String.raw`^[,\s]+(?:${POSTCODE}\s+)?${NAME}(?=\s*$|[,.;:!?\n])`, "u");

const PATTERNS = [
    // ul. Marszałkowska 12
    new RegExp(String.raw`\b(?:${longestFirst(LEADING)})${AFTER_WORD}${STREET}\s+${NUMBER}\b`, "gu"),
    // Hauptstraße 5
    new RegExp(String.raw`\b\p{Lu}[\p{L}'’-]*(?:${longestFirst(TRAILING)})\.?\s+${NUMBER}\b`, "gu"),
    // 123 Main Street
    new RegExp(String.raw`\b${NUMBER}\s+${NAME}\s+(?:${longestFirst(ENGLISH)})\b\.?`, "gu"),
    // 10 rue de Rivoli: France and Spain put the number first and the street word after it
    new RegExp(String.raw`\b${NUMBER},?\s+(?:${longestFirst(LEADING)})${AFTER_WORD}${STREET}`, "gu"),
    // Morska 1, 76-032 Mielno: no street word at all, but a postcode and a town can be nothing else
    new RegExp(String.raw`\b${NAME}\s+${NUMBER},?\s+${POSTCODE}\s+${NAME}`, "gu"),
];

/**
 * The same address with nothing to mark it as one: "Morska 1 Mielno", a street, a number and a town.
 *
 * That shape alone is not enough to go on - "Nokia 3310 Classic" is written exactly the same way - so it
 * is read only when the last part is a town that exists, which is what the gazetteer is for
 * (localities.ts). Without one, the reading below is used instead.
 */
const BARE = new RegExp(String.raw`\b(${NAME})\s+${NUMBER},?\s+(?:${POSTCODE}\s+)?(${NAME})`, "gu");

/**
 * And the same address as the entire message, which is how one is sent when it is sent on its own.
 * Nobody writes a message consisting only of a phone's name, so this needs no gazetteer - it is what is
 * read where there is none.
 */
const WHOLE_MESSAGE = new RegExp(String.raw`^${NAME}\s+${NUMBER}(?:,?\s+(?:${POSTCODE}\s+)?${NAME})?[.!]?$`, "u");

/** How much of what follows a street is part of the address: its postcode and town, when they are given. */
function localityAfter(text: string, end: number): number {
    const match = LOCALITY.exec(text.slice(end, end + 60));
    return match ? end + match[0].length : end;
}

/**
 * The places named in `text`.
 *
 * Overlapping readings are resolved by length, because the shapes overlap on purpose: "10 rue de Rivoli"
 * is read both as a leading street word and as an English-order one, and the longer reading is the whole
 * address.
 */
export function detectAddresses(text: string, isLocality?: (name: string) => boolean): FoundAddress[] {
    const found: FoundAddress[] = [];
    for (const pattern of PATTERNS) {
        pattern.lastIndex = 0;
        for (const match of text.matchAll(pattern)) {
            const start = match.index;
            keep(found, text, start, localityAfter(text, start + match[0].length));
        }
    }

    // A street, a number and a town, with nothing marking any of them - readable only against a list of
    // the towns there are.
    if (isLocality) {
        BARE.lastIndex = 0;
        for (const match of text.matchAll(BARE)) {
            if (!namesATown(match[2], isLocality)) continue;
            keep(found, text, match.index, match.index + match[0].length);
        }
    }

    if (!found.length) {
        const trimmed = text.trim();
        const whole = WHOLE_MESSAGE.exec(trimmed);
        if (whole) keep(found, text, text.indexOf(trimmed), text.indexOf(trimmed) + whole[0].length);
    }
    return found.sort((a, b) => a.start - b.start);
}

/** Takes a reading, unless one that overlaps it says more. */
function keep(found: FoundAddress[], text: string, start: number, end: number): void {
    const entry = { text: text.slice(start, end), start, end };
    const clash = found.findIndex((other) => entry.start < other.end && entry.end > other.start);
    if (clash < 0) found.push(entry);
    else if (entry.text.length > found[clash].text.length) found[clash] = entry;
}

/** Whether what follows the house number is a town: as written, or the first word of it. */
function namesATown(name: string, isLocality: (name: string) => boolean): boolean {
    return isLocality(name) || isLocality(name.split(/\s+/)[0]);
}

/**
 * Where to look a place up: OpenStreetMap, which needs no account, follows nobody around, and opens in
 * whatever the device treats as a map.
 */
export function mapUrl(address: string): string {
    return `https://www.openstreetmap.org/search?query=${encodeURIComponent(address)}`;
}
