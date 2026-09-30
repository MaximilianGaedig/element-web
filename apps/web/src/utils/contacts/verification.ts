/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Whether a contact is who they say they are.
 *
 * The one fact about a person that only Matrix can state: their cross-signing identity, verified by this
 * account or not. It belongs on a contact card more than almost anything else on one - a card says this is
 * Ada, and this is the only line on it that can say the client has checked.
 *
 * Bridged accounts are left out. A ghost is a puppet the bridge controls: it has keys, and verifying them
 * would say something true about the bridge and nothing at all about the person on the other network, so
 * the card does not offer it and does not draw an unverified mark against somebody it could never verify.
 */

import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { type Person } from "./people";

export type Verification = "verified" | "unverified" | "changed";

/** The Matrix accounts of theirs that are really people, rather than a bridge's puppets. */
export function realAccounts(client: MatrixClient, person: Person): string[] {
    const me = client.getSafeUserId();
    return person.accounts
        .filter((account) => !account.login && account.network === "Matrix")
        .map((account) => account.mxid)
        .filter((mxid): mxid is string => !!mxid && mxid !== me);
}

/**
 * What the client can say about their identity, or nothing when there is nothing to say.
 *
 * Nothing covers the ordinary cases: no crypto, no real Matrix account of theirs, or a bridge ghost. A
 * card that drew "unverified" against every bridged contact would be saying something about the bridge
 * while looking like it was saying something about the person.
 */
export async function verificationOf(client: MatrixClient, person: Person): Promise<Verification | undefined> {
    const crypto = client.getCrypto();
    const mxids = realAccounts(client, person);
    if (!crypto || !mxids.length) return undefined;
    try {
        const statuses = await Promise.all(mxids.map((mxid) => crypto.getUserVerificationStatus(mxid)));
        // Changed identities come first: it is the one that needs the reader to do something.
        if (statuses.some((status) => status.needsUserApproval)) return "changed";
        return statuses.every((status) => status.isVerified()) ? "verified" : "unverified";
    } catch {
        return undefined;
    }
}

/** Starts verifying them, in a chat with them, which is where Matrix does it. */
export async function verify(client: MatrixClient, mxid: string): Promise<void> {
    await client.getCrypto()?.requestVerificationDM(mxid, "");
}
