/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Measurements in units you do not think in, converted: "it's 70°F" becomes 21°C, "12 miles" becomes
 * 19.3 km.
 *
 * Only the foreign direction is offered, the way iOS does it: somewhere that measures in metres does not
 * want its own kilometres restated in miles. Which direction is foreign comes from the reader's locale,
 * so this does the right thing for someone reading in English from Poland.
 *
 * Currencies are deliberately not here: they need today's rate, which means asking somebody for it, and
 * a rate that is quietly a week old is worse than no conversion at all.
 */

export interface FoundMeasure {
    text: string;
    start: number;
    end: number;
    /** What it comes to, written the way the reader writes numbers. */
    converted: string;
}

interface Unit {
    /** How the unit is written, after the number. */
    written: RegExp;
    to: (value: number) => number;
    /** The unit it becomes. */
    unit: string;
    /** How precise the answer is worth being. */
    decimals?: number;
}

/** Imperial and American units, and what they come to. */
const IMPERIAL: Unit[] = [
    { written: /°\s?F|degrees? fahrenheit/i, to: (v) => ((v - 32) * 5) / 9, unit: "°C" },
    { written: /miles?\b|\bmi\b/i, to: (v) => v * 1.609_344, unit: "km", decimals: 1 },
    { written: /mph\b|miles per hour/i, to: (v) => v * 1.609_344, unit: "km/h" },
    { written: /feet\b|foot\b|\bft\b/i, to: (v) => v * 0.3048, unit: "m", decimals: 2 },
    { written: /inches\b|inch\b|\bin\b/i, to: (v) => v * 2.54, unit: "cm", decimals: 1 },
    { written: /yards?\b|\byd\b/i, to: (v) => v * 0.9144, unit: "m", decimals: 1 },
    { written: /pounds?\b|\blbs?\b/i, to: (v) => v * 0.453_592_37, unit: "kg", decimals: 2 },
    { written: /ounces?\b|\boz\b/i, to: (v) => v * 28.349_523_125, unit: "g" },
    { written: /gallons?\b|\bgal\b/i, to: (v) => v * 3.785_411_784, unit: "l", decimals: 1 },
];

/** And the other way, for a reader who thinks in miles. */
const METRIC: Unit[] = [
    { written: /°\s?C|degrees? celsius/i, to: (v) => (v * 9) / 5 + 32, unit: "°F" },
    { written: /kilometres?\b|kilometers?\b|\bkm\b/i, to: (v) => v / 1.609_344, unit: "mi", decimals: 1 },
    { written: /km\/h\b|kph\b/i, to: (v) => v / 1.609_344, unit: "mph" },
    { written: /metres?\b|meters?\b|\bm\b/i, to: (v) => v / 0.3048, unit: "ft", decimals: 1 },
    { written: /centimetres?\b|centimeters?\b|\bcm\b/i, to: (v) => v / 2.54, unit: "in", decimals: 1 },
    { written: /kilograms?\b|\bkg\b/i, to: (v) => v / 0.453_592_37, unit: "lb", decimals: 1 },
    { written: /litres?\b|liters?\b|\bl\b/i, to: (v) => v / 3.785_411_784, unit: "gal", decimals: 1 },
];

/** The countries that measure in miles and Fahrenheit; everywhere else is the other way round. */
const IMPERIAL_REGIONS = new Set(["US", "GB", "LR", "MM", "PR", "GU", "VI"]);

function readsImperial(locale?: string): boolean {
    const tag = locale ?? (typeof navigator === "undefined" ? "en-US" : navigator.language);
    const region = tag.split("-")[1]?.toUpperCase();
    return region ? IMPERIAL_REGIONS.has(region) : false;
}

/** A number, then the unit right after it: "70°F", "12 miles", "3.5 kg". */
const MEASURE = /(-?\d+(?:[.,]\d+)?)\s?([°a-zA-Z][a-zA-Z/°.\s]{0,18})/g;

/**
 * The measurements in `text` worth converting, with what they come to.
 *
 * `locale` is for tests and for reading a message as somebody else would.
 */
export function detectMeasures(text: string, locale?: string): FoundMeasure[] {
    const foreign = readsImperial(locale) ? METRIC : IMPERIAL;
    const found: FoundMeasure[] = [];

    for (const match of text.matchAll(MEASURE)) {
        const value = Number(match[1].replace(",", "."));
        if (!Number.isFinite(value)) continue;
        const written = match[2];
        // The unit is what comes right after the number; anything past it is the sentence going on.
        const unit = foreign.find((candidate) => {
            const at = written.search(candidate.written);
            return at === 0 || (at === 1 && written.startsWith(" "));
        });
        if (!unit) continue;
        const asWritten = new RegExp(unit.written.source, "i").exec(written);
        if (!asWritten) continue;
        // Where the unit sits in the text: the space between the number and it belongs to the match
        // but to neither group, so the group's own offset is what has to be measured from.
        const writtenAt = match.index + (match[0].length - written.length);
        const end = writtenAt + written.indexOf(asWritten[0]) + asWritten[0].length;
        const converted = unit.to(value);
        const decimals = unit.decimals ?? 0;
        found.push({
            text: text.slice(match.index, end),
            start: match.index,
            end,
            converted: `${converted.toFixed(decimals).replace(/\.0+$/, "")} ${unit.unit}`,
        });
    }
    return found;
}
