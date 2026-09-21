#!/usr/bin/env node
/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Builds the town lists the address detector asks: "is this word a place?"
 *
 * Why a filter and not the names: a country has tens of thousands of towns, which is hundreds of
 * kilobytes of text and a set to build on every load. The only question ever asked of them is whether
 * one name is among them, which a Bloom filter answers from a bitmap a tenth of that size and no
 * parsing at all - and its one weakness, saying yes to a name that was never added, costs at worst a
 * map lookup offered for something that was not a place. One country's filter is fetched: the one the
 * reader is in.
 *
 * The names are GeoNames' populated places (feature class P), CC BY 4.0 - credited in the README this
 * writes beside them.
 *
 *   node scripts/build-locality-filters.ts PL DE GB
 *
 * What it writes is committed: it changes when a country is added, not when the app is built, and a
 * build that needs the network is a build that breaks.
 */

import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { FILTER_BITS_PER_NAME, HASHES, normaliseLocality, setBit } from "../apps/web/src/utils/detect/bloom.ts";

const run = promisify(execFile);
const OUT = new URL("../apps/web/res/locality/", import.meta.url);
const COUNTRIES = process.argv.slice(2).length ? process.argv.slice(2) : ["PL", "DE", "GB"];

/** GeoNames' columns: what a place is called, what else it is called, and what kind of thing it is. */
const NAME = 1;
const ALTERNATES = 3;
const FEATURE_CLASS = 6;

async function namesOf(country: string): Promise<Set<string>> {
    const work = path.join(tmpdir(), `locality-${country}`);
    await rm(work, { recursive: true, force: true });
    await mkdir(work, { recursive: true });
    const zip = path.join(work, `${country}.zip`);
    const response = await fetch(`https://download.geonames.org/export/dump/${country}.zip`);
    if (!response.ok || !response.body) throw new Error(`${country}: ${response.status} ${response.statusText}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(zip));
    await run("unzip", ["-o", "-q", zip, "-d", work]);

    const names = new Set<string>();
    const rows = await readFile(path.join(work, `${country}.txt`), "utf8");
    for (const row of rows.split("\n")) {
        const columns = row.split("\t");
        if (columns[FEATURE_CLASS] !== "P") continue;
        // What it is signposted as and what else it is called: a town is written either way.
        for (const name of [columns[NAME], ...(columns[ALTERNATES] ?? "").split(",")]) {
            const normalised = normaliseLocality(name ?? "");
            // One- and two-letter names would match ordinary words, and no address needs them.
            if (normalised.length > 2) names.add(normalised);
        }
    }
    await rm(work, { recursive: true, force: true });
    return names;
}

/** The bitmap, sized so a name that was never added is wrongly accepted about once in a hundred. */
function filterOf(names: Set<string>): Uint8Array {
    const bits = Math.ceil(names.size * FILTER_BITS_PER_NAME);
    const bytes = new Uint8Array(Math.ceil(bits / 8));
    for (const name of names) setBit(bytes, bits, name);
    // The bit count leads, so the reader has to be told nothing else.
    const out = new Uint8Array(4 + bytes.length);
    new DataView(out.buffer).setUint32(0, bits);
    out.set(bytes, 4);
    return out;
}

await mkdir(OUT, { recursive: true });
const built: string[] = [];
for (const country of COUNTRIES) {
    const names = await namesOf(country);
    const filter = filterOf(names);
    await writeFile(new URL(`${country}.bloom`, OUT), filter);
    built.push(`- \`${country}.bloom\` — ${names.size} names, ${Math.round(filter.length / 1024)} kB`);
    console.log(`${country}: ${names.size} names, ${filter.length} bytes`);
}

await writeFile(
    new URL("README.md", OUT),
    `# Town names, as Bloom filters

Built by \`scripts/build-locality-filters.ts\` from [GeoNames](https://www.geonames.org/) populated
places, licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

Each file is one country's town names as a bitmap of ${FILTER_BITS_PER_NAME} bits per name with
${HASHES} hashes: it says with certainty that a name is *not* a town, and with about 99% certainty that
it is one. \`utils/detect/addresses.ts\` asks it, which is how "Morska 1 Mielno" is read as an address
and "Nokia 3310 Classic" is not.

${built.join("\n")}
`,
);
