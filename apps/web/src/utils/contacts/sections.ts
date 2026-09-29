/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * A contact list read by its initials.
 *
 * A flat list of everybody is scrolled; a sectioned one is jumped into, which is what the letters down the
 * edge of a phone's contact list are for. Both halves come from one grouping, so the letters on the edge are
 * exactly the sections that exist: an index offering a letter with nothing behind it is worse than no index.
 */

/**
 * The letter a name files under: its first letter, or "#" for a name that does not start with one.
 *
 * Accents are folded away first, so Emile and Émile file together under E rather than into two sections a
 * letter apart - which is how a phone's contact list reads, and the reason it can offer one letter per row.
 */
export function initialOf(name: string): string {
    const first = [...name.trim().normalize("NFD").replace(/\p{M}/gu, "")][0];
    return first && /\p{L}/u.test(first) ? first.toLocaleUpperCase() : "#";
}

export interface Section<T> {
    letter: string;
    items: T[];
}

/**
 * Items grouped by initial, in name order, with the "#" group last.
 *
 * Collated by the locale's own rules rather than by code point, so an accented name sorts where a reader
 * expects it rather than after Z.
 */
export function sectionsOf<T>(items: T[], nameOf: (item: T) => string): Section<T>[] {
    const groups = new Map<string, T[]>();
    for (const item of [...items].sort((a, b) => nameOf(a).localeCompare(nameOf(b)))) {
        const letter = initialOf(nameOf(item));
        const group = groups.get(letter);
        if (group) group.push(item);
        else groups.set(letter, [item]);
    }
    return (
        [...groups]
            .map(([letter, grouped]) => ({ letter, items: grouped }))
            // "#" is not a letter, so it cannot be collated with them: it goes last, as it does on a phone.
            .sort((a, b) => (a.letter === "#" ? 1 : b.letter === "#" ? -1 : a.letter.localeCompare(b.letter)))
    );
}
