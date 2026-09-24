/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Recognising one person across networks.
 *
 * The same person is a WhatsApp number, a Signal account, a Messenger profile and a Telegram username, and to
 * the client they are four strangers with four Matrix IDs. What ties them together is what the networks
 * themselves publish about them: `tel:` and `mailto:` identifiers (mautrix `UserInfo.Identifiers`, exposed
 * per contact by the bridges' provisioning API and in ghost profiles where the server supports extended
 * profile fields).
 *
 * So identities are matched on those identifiers and on nothing else. Two rules, both learned from what goes
 * wrong otherwise:
 *
 * - **Never guess a phone number from a Matrix ID.** A WhatsApp ghost is `@wa_441632960123:…`, which is a
 *   phone number, and a Messenger ghost is `@facebook_100000000000001:…`, which is not - it is an account ID
 *   that happens to be fifteen digits. Guessing merges unrelated people, and the merge is invisible to the
 *   reader because both rows look plausible.
 * - **Never match on names.** Two people called Bob Carter are two people. Names are for offering a link the
 *   reader confirms (see people.ts), never for making one.
 */

/** A key two accounts can be equal by: `tel:+441632960123`, `mailto:a@b.c`. */
export type IdentityKey = string;

/**
 * A phone number as a key, or nothing if it cannot be made into one.
 *
 * Kept deliberately dumb: strip everything that is not a digit, keep a leading `+`, and refuse anything that
 * is not plausibly a number. No country guessing - a local number written without a country code cannot be
 * compared with one from another network without knowing where the reader is, and getting that wrong merges
 * two different people. Networks publish E.164 (`tel:+44…`), so the case that matters is already handled.
 */
export function phoneKey(raw: string): IdentityKey | undefined {
    const digits = raw.replace(/[^\d]/g, "");
    if (digits.length < 7 || digits.length > 15) return undefined;
    // Without a leading + there is no country, and two shapes of the same number must not be one key.
    if (!raw.trim().startsWith("+") && !raw.trim().toLowerCase().startsWith("tel:+")) return undefined;
    return `tel:+${digits}`;
}

/** An email address as a key, lowercased because nobody means case there. */
export function emailKey(raw: string): IdentityKey | undefined {
    const at = raw.indexOf("@");
    if (at <= 0 || at === raw.length - 1 || /\s/.test(raw)) return undefined;
    return `mailto:${raw.trim().toLowerCase()}`;
}

/**
 * The keys one account can be recognised by.
 *
 * Takes what the network published, in whatever shape: `tel:+44…`, a bare `+44 1632 960 123`, `mailto:` or a
 * bare address. Anything else - a username, a numeric account id, a nickname - is not a key: it is only
 * unique within one network, so matching on it across networks says nothing.
 */
export function identityKeys(identifiers: readonly string[] | undefined): IdentityKey[] {
    const keys = new Set<IdentityKey>();
    for (const raw of identifiers ?? []) {
        const value = raw.trim();
        if (!value) continue;
        const lower = value.toLowerCase();
        if (lower.startsWith("tel:")) {
            const key = phoneKey(value.slice(4));
            if (key) keys.add(key);
        } else if (lower.startsWith("mailto:")) {
            const key = emailKey(value.slice(7));
            if (key) keys.add(key);
        } else if (value.startsWith("+")) {
            const key = phoneKey(value);
            if (key) keys.add(key);
        } else if (value.includes("@") && !value.startsWith("@")) {
            // A bare address, but not a Matrix ID: those start with @ and are not identities of their own.
            const key = emailKey(value);
            if (key) keys.add(key);
        }
    }
    return [...keys];
}

/** How a key reads to a person: the number or address itself, without the scheme. */
export const readKey = (key: IdentityKey): string => key.replace(/^tel:/, "").replace(/^mailto:/, "");
