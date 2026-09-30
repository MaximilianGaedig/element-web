/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The colour a person's card is drawn in.
 *
 * A contact with no picture is an initial on a coloured disc, and which colour is worth the reader's say:
 * it is the fastest way to tell two people of the same name apart in a list, and it is the one part of a
 * card that is theirs rather than the network's. Kept in account data beside the links and the nicknames
 * (see LINKS_EVENT_TYPE in people.ts), so it follows the account rather than the browser.
 *
 * Only a choice is stored. With none, the disc keeps the colour the client already derives from the
 * person's ID, which is stable and different for different people - so nothing needs to be chosen for the
 * list to work, and a colour never has to be invented for somebody who has not been given one.
 */

import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { type Person } from "./people";

/** Where a person's chosen appearance is kept. */
export const APPEARANCE_EVENT_TYPE = "im.mxg.contact_appearance";

/**
 * The colours offered: Compound's decorative palette, all six of it.
 *
 * Element's tokens rather than a set of hex values of this screen's own: they are the colours the rest of
 * the client draws avatars in, they already have light and dark forms, and a palette written here would
 * drift from them the first time either changed.
 */
export const AVATAR_COLOURS = [1, 2, 3, 4, 5, 6] as const;

export type AvatarColour = (typeof AVATAR_COLOURS)[number];

/** Which part of a name the list is sorted and filed by, as a phone lets you choose. */
export type NameOrder = "first" | "last";

interface Appearance {
    /** Which of the palette's colours, against one of the person's Matrix IDs. */
    colours?: Record<string, number>;
    /** Whether the list is filed under the first name or the family one. */
    order?: NameOrder;
}

const stored = (client: MatrixClient): Appearance =>
    client.getAccountData(APPEARANCE_EVENT_TYPE)?.getContent<Appearance>() ?? {};

/** The colour the reader chose for this person, if they chose one. */
export function chosenColour(client: MatrixClient, person: Person): AvatarColour | undefined {
    const colours = stored(client).colours ?? {};
    for (const account of person.accounts) {
        const found = account.mxid ? colours[account.mxid] : undefined;
        if (typeof found === "number" && (AVATAR_COLOURS as readonly number[]).includes(found)) {
            return found as AvatarColour;
        }
    }
    return undefined;
}

/**
 * Records the colour, against every one of their Matrix IDs.
 *
 * Against all of them for the same reason a nickname is: a person here is several accounts, and writing
 * the choice against only the first would lose it the moment the merge is undone or rebuilt in another
 * order. Passing no colour takes the choice away rather than storing a default.
 */
export async function setColour(client: MatrixClient, person: Person, colour?: AvatarColour): Promise<void> {
    const colours = { ...stored(client).colours };
    for (const account of person.accounts) {
        if (!account.mxid) continue;
        if (colour === undefined) delete colours[account.mxid];
        else colours[account.mxid] = colour;
    }
    await client.setAccountData(APPEARANCE_EVENT_TYPE, { colours });
}

/**
 * Whether the list files people under their first name or their family name.
 *
 * A setting rather than a guess: which one is right depends on the reader's language and habit, not on the
 * names themselves, and every address book worth the name asks. Defaults to the first name, which is what
 * a list built from chat display names is already sorted by.
 */
export const nameOrder = (client: MatrixClient): NameOrder => (stored(client).order === "last" ? "last" : "first");

export async function setNameOrder(client: MatrixClient, order: NameOrder): Promise<void> {
    await client.setAccountData(APPEARANCE_EVENT_TYPE, { ...stored(client), order });
}
