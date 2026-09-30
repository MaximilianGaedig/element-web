/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * What other Matrix accounts publish about themselves, read as card fields.
 *
 * The bridges publish what a network knows about a ghost as MSC4133 extended profile fields, and this
 * client reads them (utils/contacts/people.ts). Any Matrix account can put the same fields on its own
 * profile - a number, an address, a company - and they are read here the same way.
 */

import { type ContactCard } from "./card";

/** The fields a profile can carry, using the keys the bridges already use for the same facts. */
const PROFILE_KEYS = {
    phone: "com.beeper.bridge.identifiers",
    email: "im.mxg.email",
    company: "im.mxg.company",
    jobTitle: "im.mxg.job_title",
} as const;

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
