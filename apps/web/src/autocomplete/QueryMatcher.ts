/*
Copyright 2024 New Vector Ltd.
Copyright 2018 Michael Telatynski <7t3chguy@gmail.com>
Copyright 2018 New Vector Ltd
Copyright 2017 Aviral Dasgupta

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { at, uniq } from "lodash";
import { removeHiddenChars } from "matrix-js-sdk/src/utils";

import { type TimelineRenderingType } from "../contexts/RoomContext";
import { type Leaves } from "../@types/common";
import { fuzzyMatch } from "../utils/search/fuzzy";

interface IOptions<T extends object> {
    keys: Array<Leaves<T>>;
    funcs?: Array<(o: T) => string | string[]>;
    shouldMatchWordsOnly?: boolean;
    // whether to apply unhomoglyph and strip diacritics to fuzz up the search. Defaults to true
    fuzzy?: boolean;
    context?: TimelineRenderingType;
}

/**
 * Search matcher that ranks results by how well the query matches their search
 * keys (see utils/search/fuzzy.ts): accents are folded, the typed words may come
 * in any order, and one typo per word is forgiven. Ties are broken by which of
 * the keys matched - so a display name beats a user ID - and then by the order
 * the items appeared in the source array.
 *
 * @param {Object[]} objects Initial list of objects. Equivalent to calling
 *     setObjects() after construction
 * @param {Object} options Options object
 * @param {string[]} options.keys List of keys to use as indexes on the objects
 * @param {function[]} options.funcs List of functions that when called with the
 *     object as an arg will return a string to use as an index
 */
export default class QueryMatcher<T extends object> {
    private _options: IOptions<T>;
    private _items = new Map<string, { object: T; keyWeight: number }[]>();

    public constructor(objects: T[], options: IOptions<T> = { keys: [] }) {
        this._options = options;

        this.setObjects(objects);

        // By default, we remove any non-alphanumeric characters ([^A-Za-z0-9_]) from the
        // query and the value being queried before matching
        if (this._options.shouldMatchWordsOnly === undefined) {
            this._options.shouldMatchWordsOnly = true;
        }
    }

    public setObjects(objects: T[]): void {
        this._items = new Map();

        for (const object of objects) {
            // Need to use unsafe coerce here because the objects can have any
            // type for their values. We assume that those values who's keys have
            // been specified will be string. Also, we cannot infer all the
            // types of the keys of the objects at compile.
            const keyValues = at<string>(<any>object, this._options.keys);

            if (this._options.funcs) {
                for (const f of this._options.funcs) {
                    const v = f(object);
                    if (Array.isArray(v)) {
                        keyValues.push(...v);
                    } else {
                        keyValues.push(v);
                    }
                }
            }

            for (const [index, keyValue] of Object.entries(keyValues)) {
                if (!keyValue) continue; // skip falsy keyValues
                const key = this.processQuery(keyValue);
                if (!this._items.has(key)) {
                    this._items.set(key, []);
                }
                this._items.get(key)!.push({
                    keyWeight: Number(index),
                    object,
                });
            }
        }
    }

    public match(query: string, limit = -1): T[] {
        query = this.processQuery(query);
        if (this._options.shouldMatchWordsOnly) {
            query = query.replace(/[^\w]/g, "");
        }
        if (query.length === 0) {
            return [];
        }

        /*
         * One pass over every key, ranked together.
         *
         * The keys are one flat haystack so that the matcher can rank them against each other -
         * ranking each key separately and merging afterwards loses the comparison that matters. An
         * item can own several keys, and `keyWeight` (its position in `options.keys`) is what makes
         * the display name win over the ID when both match.
         */
        const searchable = [...this._items.entries()].map(([key, candidates]) => ({
            item: candidates,
            keys: [this._options.shouldMatchWordsOnly ? key.replace(/[^\w]/g, "") : key],
        }));

        const matches = fuzzyMatch(searchable, query, { mode: "completion" }).flatMap(({ item, rank }) =>
            item.map((candidate) => ({ rank, ...candidate })),
        );

        // Best match first; within one key, the earliest key of the object it came from.
        matches.sort((a, b) => a.rank - b.rank || a.keyWeight - b.keyWeight);

        // Now map the keys to the result objects. Also remove any duplicates.
        const dedupped = uniq(matches.map((match) => match.object));
        const maxLength = limit === -1 ? dedupped.length : limit;

        return dedupped.slice(0, maxLength);
    }

    private processQuery(query: string): string {
        if (this._options.fuzzy !== false) {
            // lower case both the input and the output for consistency
            return removeHiddenChars(query.toLowerCase()).toLowerCase();
        }
        return query.toLowerCase();
    }
}
