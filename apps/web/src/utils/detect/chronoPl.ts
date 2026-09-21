/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Polish dates and times for chrono, which speaks fourteen languages and not this one.
 *
 * Without it "jutro o 18:00" is either missed or, worse, read by the English parser as the right hour
 * on today's date. It is unambiguous to anyone who reads Polish, so it is read here: the days one talks
 * about (dziś, jutro, pojutrze, and the weekday names), the months, and the times they are said with
 * ("o 18:00", "o 18", "godz. 18:30").
 *
 * The grammar covered is the shape of an arrangement - a day, optionally a time - not the language.
 * Anything else is left to the parsers chrono already has.
 */

import { Chrono, type ParsedResult, type ParsingContext, type ParsingComponents } from "chrono-node";

/** How many days from the reference day each word means. */
const RELATIVE_DAYS: Record<string, number> = {
    przedwczoraj: -2,
    wczoraj: -1,
    dziś: 0,
    dzis: 0,
    dzisiaj: 0,
    jutro: 1,
    jutra: 1,
    pojutrze: 2,
};

/** Monday first, as the week runs here; the forms a sentence puts them in are matched too. */
const WEEKDAYS: Record<string, number> = {
    poniedziałek: 1,
    poniedzialek: 1,
    wtorek: 2,
    środa: 3,
    sroda: 3,
    środę: 3,
    srode: 3,
    czwartek: 4,
    piątek: 5,
    piatek: 5,
    sobota: 6,
    sobotę: 6,
    sobote: 6,
    niedziela: 0,
    niedzielę: 0,
    niedziele: 0,
};

/** The genitive forms a date is written in: "21 września". */
const MONTHS: Record<string, number> = {
    stycznia: 1,
    lutego: 2,
    marca: 3,
    kwietnia: 4,
    maja: 5,
    czerwca: 6,
    lipca: 7,
    sierpnia: 8,
    września: 9,
    wrzesnia: 9,
    października: 10,
    pazdziernika: 10,
    listopada: 11,
    grudnia: 12,
};

const alternatives = (words: Record<string, unknown>): string =>
    Object.keys(words)
        .sort((a, b) => b.length - a.length)
        .join("|");

/** "o 18:00", "o 18", "godz. 18.30", or a bare time right after a day. */
const TIME = String.raw`(?:\s*(?:o|ok\.|około|godz\.?|godzinie)?\s*(\d{1,2})(?:[:.](\d{2}))?)?`;

const DAY_RE = new RegExp(String.raw`\b(${alternatives(RELATIVE_DAYS)})\b${TIME}`, "i");
const WEEKDAY_RE = new RegExp(String.raw`\b(?:w\s+|we\s+)?(${alternatives(WEEKDAYS)})\b${TIME}`, "i");
const DATE_RE = new RegExp(String.raw`\b(\d{1,2})\s+(${alternatives(MONTHS)})\b(?:\s+(\d{4}))?${TIME}`, "i");

/** Assigns the time when one was written, and says whether it was. */
function withTime(components: ParsingComponents, hour?: string, minute?: string): ParsingComponents {
    const hours = hour === undefined ? undefined : Number(hour);
    if (hours === undefined || hours > 23) return components;
    const minutes = Number(minute ?? 0);
    if (minutes > 59) return components;
    return components.assign("hour", hours).assign("minute", minutes);
}

function dayComponents(context: ParsingContext, date: Date): ParsingComponents {
    return context
        .createParsingComponents()
        .assign("year", date.getFullYear())
        .assign("month", date.getMonth() + 1)
        .assign("day", date.getDate());
}

/** dziś, jutro, pojutrze … with the time they were said with. */
const relativeDayParser = {
    pattern: (): RegExp => DAY_RE,
    extract(context: ParsingContext, match: RegExpMatchArray): ParsingComponents {
        const date = context.reference.getDateWithAdjustedTimezone();
        date.setDate(date.getDate() + RELATIVE_DAYS[match[1].toLowerCase()]);
        return withTime(dayComponents(context, date), match[2], match[3]);
    },
};

/** A weekday names the next such day, which is what "w piątek" means when said today. */
const weekdayParser = {
    pattern: (): RegExp => WEEKDAY_RE,
    extract(context: ParsingContext, match: RegExpMatchArray): ParsingComponents {
        const date = context.reference.getDateWithAdjustedTimezone();
        const wanted = WEEKDAYS[match[1].toLowerCase()];
        const ahead = (wanted - date.getDay() + 7) % 7 || 7;
        date.setDate(date.getDate() + ahead);
        return withTime(dayComponents(context, date), match[2], match[3]);
    },
};

/** "21 września", with the year when it is given. */
const dateParser = {
    pattern: (): RegExp => DATE_RE,
    extract(context: ParsingContext, match: RegExpMatchArray): ParsingComponents {
        const day = Number(match[1]);
        const month = MONTHS[match[2].toLowerCase()];
        const year = match[3] ? Number(match[3]) : context.reference.getDateWithAdjustedTimezone().getFullYear();
        if (day > new Date(year, month, 0).getDate()) return context.createParsingComponents();
        const components = context
            .createParsingComponents()
            .assign("year", year)
            .assign("month", month)
            .assign("day", day);
        return withTime(components, match[4], match[5]);
    },
};

const chronoPl = new Chrono({ parsers: [relativeDayParser, weekdayParser, dateParser], refiners: [] });

/** Polish dates and times in `text`, read against `reference`. */
export function parsePolish(text: string, reference: Date): ParsedResult[] {
    return chronoPl.parse(text, reference);
}
