/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Reading a display name as a first name and a family name.
 *
 * A network gives one string. Filing by family name, showing a card with the parts filled in, and sorting
 * the way the reader asked for all need two - so the string is read, carefully, because most of what a
 * bridge hands over is not a two-word English name: it is a phone number, a username, a company, a mononym,
 * a name with a particle in it, or a name in a script that does not put a space between the parts.
 *
 * Nothing here is written to a card on its own. It is what the list files by when the reader has not said
 * otherwise, and what the editor starts from - so a guess can always be corrected and the correction is
 * what is then stored.
 */

/**
 * The words that belong to the family name rather than sitting between the two.
 *
 * "van der Berg" is one surname and files under V; "de Souza" files under D. Taking only the last word
 * would file them under B and S, which is where a reader would never look for them.
 */
const PARTICLES = new Set([
    "van",
    "von",
    "de",
    "del",
    "della",
    "der",
    "den",
    "di",
    "da",
    "das",
    "dos",
    "du",
    "la",
    "le",
    "lo",
    "bin",
    "ibn",
    "al",
    "ter",
    "ten",
    "op",
    "st",
    "san",
    "santa",
]);

/** Things that trail a name without being part of it. */
const SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "i", "ii", "iii", "iv", "phd", "md", "mba", "esq"]);

export interface SplitName {
    firstName?: string;
    lastName?: string;
}

/**
 * A display name read as its parts, or nothing when it is not a name with parts.
 *
 * Returns nothing rather than guessing for the cases that are not two-part names: anything with no letters
 * in it (a phone number is the common one), and anything that is a single word - a mononym, a username, a
 * handle, or a name written without spaces, none of which have a family name to find.
 */
export function splitName(display: string): SplitName {
    const name = display.trim();
    if (!name || !/\p{L}/u.test(name)) return {};

    /*
     * "Kowalczyk, Aleksandra" is already split, and the other way round: address books export this form and
     * reading it as a first name of "Kowalczyk," would file the person under the wrong letter twice over.
     */
    const comma = name.match(/^([^,]+),\s*(.+)$/);
    if (comma) return { lastName: comma[1].trim(), firstName: comma[2].trim() };

    const words = name.split(/\s+/);
    if (words.length < 2) return { firstName: name };

    // A suffix is not the family name, and there can be more than one.
    let end = words.length - 1;
    while (end > 0 && SUFFIXES.has(words[end].toLowerCase().replace(/[.,]/g, ""))) end--;
    if (end < 1) return { firstName: name };

    // The particles immediately before the last word belong with it.
    let start = end;
    while (start > 1 && PARTICLES.has(words[start - 1].toLowerCase())) start--;

    return {
        firstName: words.slice(0, start).join(" "),
        lastName: words.slice(start, end + 1).join(" "),
    };
}

/**
 * What a person files under, given the order the reader chose.
 *
 * The card's own fields first, because those are what the reader typed; the display name read into parts
 * where there is no card. Falling back to the whole display name meant every bridged contact - which is
 * most of them - filed under their first name whatever the setting said, so "sort by last name" appeared
 * to do nothing at all.
 */
export function filingName(display: string, order: "first" | "last", card?: SplitName): string {
    const parts = card?.firstName || card?.lastName ? card : splitName(display);
    const first = parts.firstName ?? "";
    const last = parts.lastName ?? "";
    if (!first && !last) return display;
    // With only one part there is nothing to reorder, and an empty half must not lead the sort key.
    const ordered = order === "last" ? [last, first] : [first, last];
    return ordered.filter(Boolean).join(" ");
}
