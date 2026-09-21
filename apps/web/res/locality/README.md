# Town names, as Bloom filters

Built by `scripts/build-locality-filters.ts` from [GeoNames](https://www.geonames.org/) populated
places, licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

Each file is one country's town names as a bitmap of 10 bits per name with
7 hashes: it says with certainty that a name is _not_ a town, and with about 99% certainty that
it is one. `utils/detect/addresses.ts` asks it, which is how "Morska 1 Mielno" is read as an address
and "Nokia 3310 Classic" is not.

- `PL.bloom` — 61640 names, 75 kB
- `DE.bloom` — 121723 names, 149 kB
- `GB.bloom` — 52410 names, 64 kB
