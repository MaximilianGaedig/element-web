/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * A Bloom filter over names, small enough to fetch and answered without parsing anything.
 *
 * Both the program that builds one (scripts/build-locality-filters.ts) and the app that asks it are
 * here, because the answer is only right while the two hash the same way: a filter is a bitmap and
 * nothing in it says how the bits were chosen.
 */

/**
 * How many bits each name gets. Ten bits with seven hashes is the textbook point where a name that was
 * never added is wrongly accepted about once in a hundred, which for offering a map lookup is nothing.
 */
export const FILTER_BITS_PER_NAME = 10;
export const HASHES = 7;

/**
 * A name as it is looked up: lower case, without its accents, and with the punctuation people vary -
 * hyphens and apostrophes in "Bielsko-Biała", "L'Aquila" - reduced to single spaces. So a town matches
 * however it was typed.
 */
export function normaliseLocality(name: string): string {
    return name
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
}

/** FNV-1a, which is four lines and spreads short names well enough for this. */
function fnv1a(text: string, basis: number): number {
    let hash = basis;
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x0100_0193);
    }
    return hash >>> 0;
}

/**
 * The bits a name owns. Two hashes make all seven, the standard way: one to start at and one to step
 * by, which costs one pass over the name instead of seven.
 *
 * @yields each bit index the name claims.
 */
function* bitsOf(name: string, bits: number): Generator<number> {
    const start = fnv1a(name, 0x811c_9dc5);
    // An odd step is coprime with any power of two and keeps the walk from repeating a bit early.
    const step = fnv1a(name, 0x0100_0193) | 1;
    for (let index = 0; index < HASHES; index++) {
        // Back to unsigned before the remainder: `Math.imul` answers a signed 32-bit number, and a
        // negative bit index is not an error a typed array reports - it writes nothing and reads
        // nothing, which is a name quietly missing from its own filter.
        yield ((start + Math.imul(index, step)) >>> 0) % bits;
    }
}

export function setBit(bytes: Uint8Array, bits: number, name: string): void {
    for (const bit of bitsOf(name, bits)) {
        bytes[bit >>> 3] |= 1 << (bit & 7);
    }
}

/** Whether the filter holds the name: `false` is certain, `true` is almost. */
export function hasName(bytes: Uint8Array, bits: number, name: string): boolean {
    for (const bit of bitsOf(name, bits)) {
        if (!(bytes[bit >>> 3] & (1 << (bit & 7)))) return false;
    }
    return true;
}

/** Reads a built filter: its bit count leads, the bitmap follows. */
export function readFilter(data: ArrayBuffer): (name: string) => boolean {
    const bits = new DataView(data).getUint32(0);
    const bytes = new Uint8Array(data, 4);
    return (name) => {
        const normalised = normaliseLocality(name);
        return normalised.length > 2 && hasName(bytes, bits, normalised);
    };
}
