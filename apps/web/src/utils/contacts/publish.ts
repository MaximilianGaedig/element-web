/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The reader's own card, on their Matrix profile - and other people's, off theirs.
 *
 * The bridges publish what a network knows about a ghost as MSC4133 extended profile fields, and this
 * client reads them (utils/contacts/people.ts). The same road runs the other way: a Matrix account can
 * publish its own number, address and company on its own profile, and every other client that reads
 * MSC4133 then has them. That is the address book being part of Matrix rather than a private file that
 * happens to live in account data.
 *
 * Publishing is asked for, never automatic. These fields are readable by anyone who can see the profile,
 * which for most homeservers is anyone at all - so what goes up is chosen field by field and the default
 * is that nothing does.
 */

import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { type ContactCard } from "./card";

/** The fields a profile can carry, using the keys the bridges already use for the same facts. */
const PROFILE_KEYS = {
    phone: "com.beeper.bridge.identifiers",
    email: "im.mxg.email",
    company: "im.mxg.company",
    jobTitle: "im.mxg.job_title",
} as const;

/** What of their own card the reader chose to publish. */
export type Publishable = keyof typeof PROFILE_KEYS;

export const PUBLISHABLE: Publishable[] = ["phone", "email", "company", "jobTitle"];

/**
 * Puts the chosen fields on the reader's own profile and takes away the ones they unchose.
 *
 * Written field by field (MSC4133's per-key endpoint, which this homeserver advertises as
 * `uk.tcpip.msc4133.stable`) rather than as one overwrite, so publishing a phone number cannot quietly
 * delete something else that is already on the profile.
 */
export async function publishOwnCard(
    client: MatrixClient,
    card: ContactCard,
    chosen: ReadonlySet<Publishable>,
): Promise<void> {
    const values: Record<Publishable, unknown> = {
        // The same shape the bridges publish, so anything reading a ghost's identifiers reads these too.
        phone: (card.phones ?? []).map((phone) => `tel:${phone.value}`),
        email: (card.emails ?? []).map((email) => email.value),
        company: card.company,
        jobTitle: card.jobTitle,
    };
    for (const field of PUBLISHABLE) {
        const key = PROFILE_KEYS[field];
        const value = values[field];
        const wanted = chosen.has(field) && (Array.isArray(value) ? value.length > 0 : !!value);
        try {
            if (wanted) await client.setExtendedProfileProperty(key, value);
            else await client.deleteExtendedProfileProperty(key);
        } catch {
            // A field the server will not take is one field, not a reason to abandon the rest.
        }
    }
}

/**
 * What another Matrix account publishes about itself, as card fields.
 *
 * The reader's own card for somebody always wins over this: what they typed is theirs, and a profile
 * changing should not overwrite it. This fills the gaps rather than replacing anything.
 */
export function cardFromProfile(profile: Record<string, unknown>): ContactCard {
    const strings = (raw: unknown): string[] =>
        Array.isArray(raw) ? raw.filter((one): one is string => typeof one === "string") : [];
    const text = (raw: unknown): string | undefined => (typeof raw === "string" && raw ? raw : undefined);
    return {
        phones: strings(profile[PROFILE_KEYS.phone])
            .filter((one) => one.startsWith("tel:"))
            .map((one) => ({ label: "mobile", value: one.slice(4) })),
        emails: strings(profile[PROFILE_KEYS.email]).map((one) => ({ label: "home", value: one })),
        company: text(profile[PROFILE_KEYS.company]),
        jobTitle: text(profile[PROFILE_KEYS.jobTitle]),
    };
}

/**
 * What any of their accounts published about itself, if any of them published anything.
 *
 * Shown only where the reader has written nothing of their own: what they typed is theirs, and somebody
 * editing their Matrix profile must not silently rewrite a card here.
 */
export function publishedCardOf(person: {
    accounts: readonly { publishedCard?: ContactCard }[];
}): ContactCard | undefined {
    for (const account of person.accounts) {
        const card = account.publishedCard;
        if (card && (card.phones?.length || card.emails?.length || card.company || card.jobTitle)) return card;
    }
    return undefined;
}
