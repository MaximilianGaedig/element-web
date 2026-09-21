/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Whether a word is the name of a town.
 *
 * This is the one thing that tells "Morska 1 Mielno" - a street, a house number and a town, which is how
 * an address is written when it is written plainly - from "Nokia 3310 Classic", which is the same three
 * shapes and not an address. No amount of grammar separates them; knowing the towns does.
 *
 * One country's names are fetched, the reader's own, as a bitmap of some tens of kilobytes (see bloom.ts
 * and the script that builds it). It is fetched the first time a message looks like it might hold an
 * address, kept for the session, and cached by the service worker with the rest of the build - so it
 * works offline after the first time and costs nothing on startup. Where there is no file for the
 * country, or it cannot be fetched, nothing is claimed: `localityFilter` answers `undefined` and the
 * detector falls back to the readings that need no gazetteer.
 */

import { readFilter } from "./bloom";

/** The countries whose names are built into this app - see `res/locality`. */
const AVAILABLE = new Set(["PL", "DE", "GB"]);

export type LocalityFilter = (name: string) => boolean;

/** Asked once per country per session, successful or not. */
const loading = new Map<string, Promise<LocalityFilter | undefined>>();

/** The country whose towns to know about: where the reader is, as their language says. */
function region(): string | undefined {
    const parts = typeof navigator === "undefined" ? [] : navigator.language.split("-");
    const region = parts[1]?.toUpperCase();
    // A bare "pl" says the language and not the country, and for these languages they are the same.
    return region ?? { pl: "PL", de: "DE", en: "GB" }[parts[0]?.toLowerCase() ?? ""];
}

async function fetchFilter(country: string): Promise<LocalityFilter | undefined> {
    try {
        const response = await fetch(new URL(`locality/${country}.bloom`, document.baseURI));
        if (!response.ok) return undefined;
        return readFilter(await response.arrayBuffer());
    } catch {
        // Offline before it was ever fetched: the detector does without it.
        return undefined;
    }
}

/**
 * The town names of the reader's country, or `undefined` where there are none to be had.
 *
 * `country` is for tests and for reading a message whose language says otherwise.
 */
export function localityFilter(country = region()): Promise<LocalityFilter | undefined> {
    if (!country || !AVAILABLE.has(country)) return Promise.resolve(undefined);
    const pending = loading.get(country) ?? fetchFilter(country);
    loading.set(country, pending);
    return pending;
}
