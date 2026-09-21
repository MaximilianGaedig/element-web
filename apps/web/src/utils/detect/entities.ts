/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * What is worth acting on in a piece of text: links, phone numbers, the times people arrange things
 * for, and the places they arrange them at. The text may be a message body or whatever was read out of
 * a picture, so this knows nothing about either.
 *
 * All three are left to libraries that know about the world's languages and countries, because the
 * hand-written alternative only ever knows about one: linkify for links, libphonenumber for numbers,
 * and chrono for dates and times in the fourteen languages it speaks.
 *
 * The one rule the libraries do not enforce, and this does: a wrong answer is worse than none. Chrono's
 * *default* parser is English, and given "Treffen morgen um 18:00" it quietly matches only the time and
 * answers today - the right hour on the wrong day. So every locale is asked, the longest match wins,
 * and a time is offered only when the text actually named a day, which chrono marks as a certainty. A
 * bare "18:00" in a language chrono does not speak is left alone rather than guessed at.
 *
 * Polish is not one of chrono's fourteen, and is the language most of these messages are written in, so
 * it has its own parser here rather than being missed - see chronoPl.ts. Addresses have no library at
 * all in a browser, for the reason addresses.ts gives, and are read by their shape there.
 */

import { find as findLinks } from "linkifyjs";
import type { CountryCode } from "libphonenumber-js";
import type { ParsedResult } from "chrono-node";

/** Something found in the text, with where it was found. */
interface Found {
    /** The text as it appeared. */
    text: string;
    start: number;
    end: number;
}

export interface DetectedUrl extends Found {
    kind: "url";
    /** With a scheme, ready to open. */
    url: string;
}

export interface DetectedPhone extends Found {
    kind: "phone";
    /** In international form, which is what a dialler wants. */
    number: string;
}

export interface DetectedDateTime extends Found {
    kind: "datetime";
    /** When it means, in local time. */
    date: Date;
    /** Whether a time of day was given, or only a day. */
    hasTime: boolean;
}

export interface DetectedAddress extends Found {
    kind: "address";
    /** Where to look it up on a map. */
    url: string;
}

export type Detected = DetectedUrl | DetectedPhone | DetectedDateTime | DetectedAddress;

/** The languages chrono speaks; each is asked, because the text does not say which it is in. */
const LOCALES = ["en", "de", "fr", "ja", "pt", "nl", "zh", "ru", "es", "uk", "it", "sv", "fi", "vi"] as const;

const MINUTE = 60_000;

const overlaps = (a: Found, b: Found): boolean => a.start < b.end && a.end > b.start;

/**
 * Links and email addresses, through the same library the timeline links with, so what is offered here
 * and what is clickable in a message agree with each other.
 */
export function detectLinks(text: string): DetectedUrl[] {
    return findLinks(text)
        .filter((match) => match.type === "url" || match.type === "email")
        .map((match) => ({
            kind: "url" as const,
            text: match.value,
            start: match.start,
            end: match.end,
            url: match.href,
        }));
}

/** The region a number written without a country code most likely belongs to. */
function defaultCountry(): CountryCode | undefined {
    const region = typeof navigator === "undefined" ? undefined : navigator.language.split("-")[1];
    return region && /^[A-Za-z]{2}$/.test(region) ? (region.toUpperCase() as CountryCode) : undefined;
}

/** Phone numbers, in international form whatever shape they were written in. */
async function detectPhones(text: string, country = defaultCountry()): Promise<DetectedPhone[]> {
    const { findNumbers } = await import("libphonenumber-js");
    // Without a region, only numbers carrying their own country code are found - which is the safe half
    // of the job, since a local number with no region to read it against could belong anywhere.
    const found = findNumbers(text, { defaultCountry: country, v2: true });
    return found.map((match) => ({
        kind: "phone" as const,
        text: text.slice(match.startsAt, match.endsAt),
        start: match.startsAt,
        end: match.endsAt,
        number: match.number.number,
    }));
}

/**
 * Dates and times, in any of the languages chrono speaks.
 *
 * Every locale is asked and the longest match wins, because the wrong locale tends to match a fragment
 * - the time alone - where the right one matches the whole phrase.
 */
async function detectDateTimes(text: string, now: Date): Promise<DetectedDateTime[]> {
    const [chrono, { parsePolish }] = await Promise.all([import("chrono-node"), import("./chronoPl")]);
    const found: DetectedDateTime[] = [];

    const results: ParsedResult[] = [
        ...LOCALES.flatMap((locale) => chrono[locale].parse(text, now)),
        ...parsePolish(text, now),
    ];

    {
        for (const result of results) {
            // The text has to have named a day. A time on its own would be read as today, which is
            // exactly how a meeting ends up in somebody's calendar a day early.
            if (!result.start.isCertain("day")) continue;
            const entry: DetectedDateTime = {
                kind: "datetime",
                text: result.text,
                start: result.index,
                end: result.index + result.text.length,
                date: result.start.date(),
                hasTime: result.start.isCertain("hour"),
            };
            const clash = found.findIndex((other) => overlaps(entry, other));
            if (clash < 0) found.push(entry);
            else if (entry.text.length > found[clash].text.length) found[clash] = entry;
        }
    }
    return found;
}

/**
 * Everything worth acting on, in the order it appears.
 *
 * Asynchronous because the languages and the world's dialling codes are a few hundred kilobytes, which
 * belong nowhere near the startup path: they load the first time something is looked at.
 */
export async function detectEntities(
    text: string,
    { now = new Date(), country }: { now?: Date; country?: CountryCode } = {},
): Promise<Detected[]> {
    const [phones, dates, { detectAddresses, mapUrl }, { localityFilter }] = await Promise.all([
        detectPhones(text, country),
        detectDateTimes(text, now),
        import("./addresses"),
        import("./localities"),
    ]);
    // The towns of the reader's country, where this app carries them: what makes a plainly written
    // address readable. Absent, the plainer readings are simply not offered.
    const towns = await localityFilter(country);
    const links = detectLinks(text);
    // A number that is part of a link is part of the link, not something to ring.
    const callable = phones.filter((phone) => !links.some((link) => overlaps(phone, link)));
    // A house number inside an address is not a phone number, and an address inside a link is the link.
    const places = detectAddresses(text, towns)
        .filter((place) => ![...links, ...callable].some((other) => overlaps(place, other)))
        .map((place) => ({ ...place, kind: "address" as const, url: mapUrl(place.text) }));
    return [...links, ...callable, ...dates, ...places].sort((a, b) => a.start - b.start);
}

/**
 * A calendar event for a detected time, as an `.ics` file: every calendar on every platform takes one,
 * with no account to connect and nothing sent anywhere.
 */
export function icsForEvent({
    title,
    start,
    hasTime,
    description,
}: {
    title: string;
    start: Date;
    hasTime: boolean;
    description?: string;
}): string {
    // A day without a time is a whole day; an appointment is an hour unless it says otherwise.
    const end = new Date(start.getTime() + (hasTime ? 60 * MINUTE : 24 * 60 * MINUTE));
    const pad = (n: number): string => String(n).padStart(2, "0");
    const stamp = (date: Date): string =>
        hasTime
            ? date.toISOString().replace(/[-:]|\.\d{3}/g, "")
            : `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
    const value = hasTime ? "" : ";VALUE=DATE";
    const escape = (text: string): string => text.replace(/([\\;,])/g, "\\$1").replace(/\n/g, "\\n");
    return [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Element//Telegram layout//EN",
        "BEGIN:VEVENT",
        `UID:${crypto.randomUUID()}`,
        `DTSTAMP:${stamp(new Date())}`,
        `DTSTART${value}:${stamp(start)}`,
        `DTEND${value}:${stamp(end)}`,
        `SUMMARY:${escape(title)}`,
        ...(description ? [`DESCRIPTION:${escape(description)}`] : []),
        "END:VEVENT",
        "END:VCALENDAR",
    ].join("\r\n");
}
