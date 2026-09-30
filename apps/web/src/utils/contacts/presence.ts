/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Whether somebody is about, across every network they are on.
 *
 * One person here is several accounts, and each network reports its own: somebody can be at their desk on
 * one and untouched for a day on another. The answer that is useful is the most awake of them - "on
 * Telegram, now" is the same fact as "about", and the other accounts being quiet says nothing against it.
 *
 * Read from the ghosts' own Matrix presence, which is where the bridges put it. Presence only: none of
 * these networks publishes a last-seen time that can be trusted for somebody who is offline, so nothing
 * here ever says how long ago - it says which state, and only the bridges' own transitions move it.
 */

import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { type Person } from "./people";

/** The states worth showing, most awake first - which is also the order they are chosen in. */
const RANK = ["online", "unavailable", "offline"] as const;

export type Presence = (typeof RANK)[number];

/** How long a network's own idea of "active" keeps counting as about, once it stops being updated. */
const STILL_ABOUT = 5 * 60 * 1000;

/** What one account says, or nothing when its network says nothing about that person. */
function presenceOf(client: MatrixClient, mxid: string): Presence | undefined {
    const user = client.getUser(mxid);
    if (!user?.presence) return undefined;
    if (user.presence === "online") {
        /*
         * An `online` that stopped being refreshed is not news any more. Bridges send presence and not a
         * last-seen time, so a ghost left online by a bridge that went away would otherwise stay lit for
         * as long as the client is open; `lastActiveAgo` is the one number that can retire it.
         */
        const ago = user.lastActiveAgo ?? 0;
        return ago > STILL_ABOUT ? "unavailable" : "online";
    }
    return user.presence === "unavailable" ? "unavailable" : "offline";
}

/**
 * The most awake thing any of their networks says about them, or nothing if none of them says anything.
 *
 * Nothing is not the same as offline: a network that has never reported is silent, and drawing somebody as
 * away because a bridge does not do presence at all would be this screen inventing a fact.
 */
export function personPresence(client: MatrixClient, person: Person): Presence | undefined {
    let best: Presence | undefined;
    for (const account of person.accounts) {
        if (!account.mxid) continue;
        const said = presenceOf(client, account.mxid);
        if (!said) continue;
        if (!best || RANK.indexOf(said) < RANK.indexOf(best)) best = said;
    }
    return best;
}

/** Which network is the one they are about on, for saying where rather than only whether. */
export function presenceNetwork(client: MatrixClient, person: Person): string | undefined {
    const best = personPresence(client, person);
    if (!best) return undefined;
    return person.accounts.find((account) => account.mxid && presenceOf(client, account.mxid) === best)?.network;
}
