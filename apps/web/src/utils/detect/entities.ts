/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * What is worth acting on in a piece of text: links, and the times people arrange things for.
 *
 * The text may be a message body or whatever was read out of a picture, so this knows nothing about
 * either - it takes a string and gives back what it found, with the span it found it in so a caller can
 * mark it up.
 *
 * It is deliberately conservative. A missed date costs a tap; a wrong one puts the wrong thing in
 * somebody's calendar, so anything ambiguous is left alone: a bare number is never a date, a day without
 * a time is a day rather than an appointment, and a date that has already passed this year is read as
 * next year only when the text says so.
 */

/** Something found in the text, with where it was found. */
export interface DetectedEntity {
    kind: "url" | "datetime";
    /** The text as it appeared. */
    text: string;
    start: number;
    end: number;
}

export interface DetectedUrl extends DetectedEntity {
    kind: "url";
    /** With a scheme, ready to open. */
    url: string;
}

export interface DetectedDateTime extends DetectedEntity {
    kind: "datetime";
    /** When it means, in local time. */
    date: Date;
    /** Whether a time of day was given, or only a day. */
    hasTime: boolean;
}

export type Detected = DetectedUrl | DetectedDateTime;

/*
 * A URL with a scheme, or a bare host that is plainly one. Trailing punctuation is left out of the
 * match: sentences end in a full stop far more often than URLs do.
 */
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+[^\s<>"'.,;:!?)\]}]/gi;

/** 18:30, 6pm, 6:05 PM. A bare hour needs am/pm: "at 6" is as likely to be a count as a time. */
const TIME_RE = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(\d{1,2}):(\d{2})\b/gi;

/** 21.09.2026, 21/09/2026, 2026-09-21, 21.09 - day first, which is how the dates here are written. */
const DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b|\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/g;

/** today, tomorrow: only ever a date when a time follows, so "tomorrow" alone stays a word. */
const RELATIVE_RE = /\b(today|tomorrow)\b/gi;

const MINUTE = 60_000;

function hasScheme(text: string): boolean {
    return /^https?:\/\//i.test(text);
}

/** Links, with a scheme added to a bare `www.` host so the result can be opened as it stands. */
export function detectUrls(text: string): DetectedUrl[] {
    return [...text.matchAll(URL_RE)].map((match) => ({
        kind: "url",
        text: match[0],
        start: match.index,
        end: match.index + match[0].length,
        url: hasScheme(match[0]) ? match[0] : `https://${match[0]}`,
    }));
}

interface TimeOfDay {
    hours: number;
    minutes: number;
    start: number;
    end: number;
}

/** The first time of day in `text` at or after `from`, if it is within `within` characters of it. */
function timeNear(text: string, from: number, within: number): TimeOfDay | undefined {
    TIME_RE.lastIndex = 0;
    for (const match of text.matchAll(TIME_RE)) {
        if (match.index < from || match.index > from + within) continue;
        const [, h12, m12, meridiem, h24, m24] = match;
        if (meridiem) {
            const hour = Number(h12) % 12;
            return {
                hours: meridiem.toLowerCase() === "pm" ? hour + 12 : hour,
                minutes: Number(m12 ?? 0),
                start: match.index,
                end: match.index + match[0].length,
            };
        }
        const hours = Number(h24);
        const minutes = Number(m24);
        if (hours > 23 || minutes > 59) continue;
        return { hours, minutes, start: match.index, end: match.index + match[0].length };
    }
    return undefined;
}

function at(base: Date, time: TimeOfDay | undefined): Date {
    const date = new Date(base);
    date.setHours(time?.hours ?? 0, time?.minutes ?? 0, 0, 0);
    return date;
}

/**
 * Dates and times, each with the span that covers the date and its time together, so "tomorrow at 18:00"
 * is one thing rather than two.
 */
export function detectDateTimes(text: string, now: Date = new Date()): DetectedDateTime[] {
    const found: DetectedDateTime[] = [];
    const taken: Array<[number, number]> = [];
    const overlaps = (start: number, end: number): boolean => taken.some(([s, e]) => start < e && end > s);

    const push = (date: Date, hasTime: boolean, start: number, end: number): void => {
        if (overlaps(start, end)) return;
        taken.push([start, end]);
        found.push({ kind: "datetime", text: text.slice(start, end), date, hasTime, start, end });
    };

    for (const match of text.matchAll(DATE_RE)) {
        const [whole, isoY, isoM, isoD, d, m, y] = match;
        const year = isoY ? Number(isoY) : y ? Number(y.length === 2 ? `20${y}` : y) : now.getFullYear();
        const month = (isoM ? Number(isoM) : Number(m)) - 1;
        const day = isoD ? Number(isoD) : Number(d);
        const date = new Date(year, month, day);
        // A date the calendar does not have - 31.02, or 13 as a month - is a number that looked like one.
        if (date.getMonth() !== month || date.getDate() !== day) continue;
        const time = timeNear(text, match.index + whole.length, 12);
        push(at(date, time), !!time, match.index, time ? time.end : match.index + whole.length);
    }

    for (const match of text.matchAll(RELATIVE_RE)) {
        const time = timeNear(text, match.index + match[0].length, 12);
        // Without a time of day this is just a word in a sentence.
        if (!time) continue;
        const date = new Date(now);
        if (match[0].toLowerCase() === "tomorrow") date.setDate(date.getDate() + 1);
        push(at(date, time), true, match.index, time.end);
    }

    return found.sort((a, b) => a.start - b.start);
}

/** Everything worth acting on, in the order it appears. */
export function detectEntities(text: string, now: Date = new Date()): Detected[] {
    return [...detectUrls(text), ...detectDateTimes(text, now)].sort((a, b) => a.start - b.start);
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
