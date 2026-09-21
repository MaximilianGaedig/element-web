/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Flight numbers, the way they are written when somebody tells you which plane they are on: "LO 381",
 * "LH1234", "W6 1301".
 *
 * The shape alone - two characters and up to four digits - is far too common to go on ("PL 123", "A4
 * 210"), so the airline has to be one that exists. That is a table, and a short one: the airlines flown
 * from here and the ones people mention. An unknown code is left alone rather than guessed at, which is
 * the same rule the rest of this folder follows.
 */

/** Airlines by their IATA code, which is what a flight number starts with. */
const AIRLINES: Record<string, string> = {
    // Poland and the neighbours
    LO: "LOT",
    W6: "Wizz Air",
    W9: "Wizz Air UK",
    FR: "Ryanair",
    RK: "Ryanair UK",
    LH: "Lufthansa",
    EW: "Eurowings",
    OS: "Austrian",
    LX: "Swiss",
    SN: "Brussels Airlines",
    KL: "KLM",
    AF: "Air France",
    BA: "British Airways",
    IB: "Iberia",
    VY: "Vueling",
    AZ: "ITA Airways",
    TP: "TAP",
    SK: "SAS",
    AY: "Finnair",
    DY: "Norwegian",
    D8: "Norwegian International",
    U2: "easyJet",
    EJU: "easyJet Europe",
    OK: "Czech Airlines",
    RO: "TAROM",
    JU: "Air Serbia",
    A3: "Aegean",
    TK: "Turkish Airlines",
    PC: "Pegasus",
    // Long haul people mention
    UA: "United",
    AA: "American",
    DL: "Delta",
    AC: "Air Canada",
    EK: "Emirates",
    QR: "Qatar Airways",
    EY: "Etihad",
    SQ: "Singapore Airlines",
    CX: "Cathay Pacific",
    NH: "ANA",
    JL: "Japan Airlines",
    KE: "Korean Air",
    QF: "Qantas",
    ET: "Ethiopian",
    MS: "EgyptAir",
    LY: "El Al",
    AI: "Air India",
    TG: "Thai Airways",
};

/** A flight found in the text. */
export interface FoundFlight {
    text: string;
    start: number;
    end: number;
    /** The airline's code and number, without the space: what a lookup wants. */
    flight: string;
    airline: string;
}

/** Two characters, a space or nothing, then the number. Capitals only: "lo 381" is not a flight. */
const FLIGHT = /\b([A-Z][A-Z0-9])\s?(\d{1,4}[A-Z]?)\b/g;

/** The flights named in `text`, by their airline. */
export function detectFlights(text: string): FoundFlight[] {
    const found: FoundFlight[] = [];
    for (const match of text.matchAll(FLIGHT)) {
        const airline = AIRLINES[match[1]];
        if (!airline) continue;
        found.push({
            text: match[0],
            start: match.index,
            end: match.index + match[0].length,
            flight: `${match[1]}${match[2]}`,
            airline,
        });
    }
    return found;
}

/**
 * Where to look a flight up: FlightAware, which shows a flight without an account and takes the
 * airline-and-number form directly in the path.
 */
export function flightUrl(flight: string): string {
    return `https://www.flightaware.com/live/flight/${encodeURIComponent(flight)}`;
}
