/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Matching what somebody typed against a list of names.
 *
 * Every search box here used to do `haystack.includes(query)`, which fails at the three things that
 * make search in other chat apps feel like it is reading your mind:
 *
 * - **Accents.** `krzys` has to find `Krzyś`, `kasia` has to find `Kasią`. A substring test says no.
 * - **Words in any order.** `ania now` has to find `Anna Nowak`. One substring cannot span a gap.
 * - **Typos.** `kasai` has to find `Kasia`; a transposition is not a substring of anything.
 *
 * and does not rank: `tasmania` and `Man` both "match" `man` equally, so the list is in whatever
 * order it was built in rather than best-first.
 *
 * So this is uFuzzy (https://github.com/leeoniya/uFuzzy) rather than anything of our own. It is a
 * matcher built for exactly this shape of problem - short strings, ranked, as-you-type - and its
 * ranking is the part worth having: term boundaries beat mid-word matches, contiguous beats
 * scattered, earlier beats later. It is one dependency of ~7 KB with none of its own.
 *
 * The configuration is the interesting part, and it is Telegram's behaviour, not uFuzzy's defaults:
 *
 * - `unicode` + `latinize`: fold accents before matching, the way tweb's `cleanSearchText` does, so
 *   Polish and Cyrillic names are reachable from a plain-ASCII keyboard.
 * - `interLft: Loose`: every typed word must start a word (or a camel-case hump) in the result, so
 *   `man` finds `mega man` and `SuperMan` but not `tasmania`. This is the rule Telegram uses and the
 *   single biggest reason its search feels precise rather than noisy.
 * - `intraMode: SingleError` with substitution, transposition and deletion allowed: one typo per
 *   word, outside its first character. Not the first character, because that is the one people get
 *   right and allowing it turns every query into a fishing expedition.
 * - `outOfOrder`: `baker alice` and `alice baker` are the same search.
 * - `compare` decides between matches uFuzzy scores equally, and it is the shorter string that wins:
 *   `123456` is a better answer for `123456` than `123456badger` is, because less of it is text the
 *   reader did not ask for. This is the same idea as a full-text engine's field-length norm. Equal
 *   lengths keep the order they were given in - which is the order the caller already decided was
 *   right (most recent room first, canonical alias first) - where uFuzzy's default would reorder
 *   them alphabetically on nothing.
 */

import UFuzzy from "@leeoniya/ufuzzy";

/** How many terms may be permuted for out-of-order matching: 3! = 6 passes, which is free. */
const PERMUTE_TERMS = 3;

/**
 * One typo per word, but never in the first character.
 *
 * Insertion is left off deliberately: it is what `intraIns` already allows for long queries, and
 * enabling all four at once on a short query matches almost anything.
 */
/** Shared by every mode: fold accents, keep ranking honest (see the note above). */
const COMMON: UFuzzy.Options = {
    unicode: true,
    compare: (a: string, b: string) => a.length - b.length,
} as const;

const ERROR_TOLERANCE: UFuzzy.Options = {
    intraMode: 1,
    intraSlice: [1, Infinity],
    intraIns: 1,
    intraSub: 1,
    intraTrn: 1,
    intraDel: 1,
};

/**
 * Names, usernames and Matrix IDs.
 *
 * `interLft: 1` means a typed word must start a word (or a camel-case hump) in the result, so `man`
 * finds `mega man` and `SuperMan` but not `tasmania`. This is the rule Telegram uses, and it is the
 * single biggest reason its search feels precise rather than noisy.
 */
const forNames = new UFuzzy({ ...COMMON, interLft: 1, ...ERROR_TOLERANCE });

/**
 * Message bodies and other prose.
 *
 * Anchored on both sides, because in a sentence a typed word almost always is a whole word, and
 * allowing mid-word matches over long text produces nonsense.
 */
const forText = new UFuzzy({ ...COMMON, interLft: 2, interRgt: 1, ...ERROR_TOLERANCE });

/**
 * Completing something half-typed, where recall matters more than precision.
 *
 * Unanchored, because this is what typing into the composer has always done here: `or` offers
 * `Victoria`, and the list is short enough that a loose match costs the reader nothing. The ranking
 * still prefers matches at a word start, so the precise ones come first.
 */
const forCompletion = new UFuzzy({ ...COMMON, interLft: 0, interRgt: 0, ...ERROR_TOLERANCE });

/** Which of the three rulesets to match by. */
export type FuzzyMode = "names" | "prose" | "completion";

const matcherFor = (mode: FuzzyMode): UFuzzy =>
    mode === "prose" ? forText : mode === "completion" ? forCompletion : forNames;

/** What a search sees: the strings to match, and what to give back for the ones that match. */
export interface Searchable<T> {
    item: T;
    /** Everything worth matching against, best first: display name, then alias, then ID. */
    keys: readonly (string | undefined)[];
}

/** One result, and how good a match it was. Lower `rank` is better. */
export interface Match<T> {
    item: T;
    rank: number;
}

/**
 * The items whose text matches `query`, best first.
 *
 * Every key of every item goes into one haystack so that uFuzzy ranks them against each other in a
 * single pass; an item is as good as its best key, and the key's position breaks ties, so a display
 * name beats a Matrix ID that happens to match equally well.
 */
export function fuzzyMatch<T>(
    items: readonly Searchable<T>[],
    query: string,
    { mode = "names", limit = Infinity }: { mode?: FuzzyMode; limit?: number } = {},
): Match<T>[] {
    const term = query.trim();
    if (!term) return items.slice(0, limit).map((entry, rank) => ({ item: entry.item, rank }));

    // One flat haystack, remembering which item and which of its keys each entry came from.
    const haystack: string[] = [];
    const owners: { at: number; keyWeight: number }[] = [];
    for (const [at, entry] of items.entries()) {
        for (const [keyWeight, key] of entry.keys.entries()) {
            if (!key) continue;
            haystack.push(key);
            owners.push({ at, keyWeight });
        }
    }

    const matcher = matcherFor(mode);
    const latin = UFuzzy.latinize(haystack);
    const [idxs, info, order] = matcher.search(latin, UFuzzy.latinize(term), PERMUTE_TERMS);
    if (!idxs) return [];

    // uFuzzy ranks haystack entries; we want items, each taken once at its best entry.
    const best = new Map<number, number>();
    const ranked = info && order ? order.map((at) => info.idx[at]) : idxs;
    for (const entry of ranked) {
        const { at, keyWeight } = owners[entry];
        if (best.has(at)) continue;
        best.set(at, keyWeight);
        if (best.size >= limit) break;
    }

    return [...best.keys()].map((at, rank) => ({ item: items[at].item, rank }));
}

/** Whether an item matches at all, for the places that only need to filter. */
export function fuzzyFilter<T>(items: readonly Searchable<T>[], query: string, mode?: FuzzyMode): T[] {
    return fuzzyMatch(items, query, { mode }).map((match) => match.item);
}

/**
 * Which of these strings match, by position.
 *
 * For callers that already walk a list of their own and only need to know whether each entry is in:
 * one pass over the whole haystack, because the expensive part of a fuzzy search is compiling the
 * needle, and doing that once per candidate is how a search stops being instant. An empty query
 * matches everything, which is what a search box with nothing in it means.
 */
export function fuzzyMatching(values: readonly string[], query: string, mode: FuzzyMode = "names"): Set<number> {
    const term = query.trim();
    if (!term) return new Set(values.keys());
    const matcher = matcherFor(mode);
    const idxs = matcher.filter(UFuzzy.latinize([...values]), UFuzzy.latinize(term));
    return new Set(idxs ?? []);
}
