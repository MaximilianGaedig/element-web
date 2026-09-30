/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Where a person is on the network itself.
 *
 * A bridged chat is a good place to write to somebody and a poor place to do anything a network keeps to
 * its own app - a profile, a business page, a voice note, whatever the bridge does not carry - so each
 * account also points at itself. Built from what the bridges publish: `com.beeper.bridge.network` says
 * which network, `com.beeper.bridge.remote_id` says which account, and the identifiers list carries the
 * phone number where a network has one (see utils/contacts/people.ts).
 *
 * The forms are each network's own published links:
 *   Telegram   https://core.telegram.org/api/links - t.me/<username>, and no public link for a numeric id.
 *   WhatsApp   https://faq.whatsapp.com/425247423114725 - wa.me/<number in full international form>.
 *   Signal     https://support.signal.org/hc/en-us/articles/6712070553498 - signal.me/#p/<+number>.
 *   Messenger  m.me/<username or id>.
 *   Discord    discord.com/users/<snowflake>.
 * The https forms are used rather than the app's own scheme (tg://, whatsapp://) because a browser can
 * open them, the phone hands them to the app when it is installed, and nothing has to be registered here.
 */

/** A phone number in the form a link wants it: digits, with the leading plus kept where there is one. */
function number(raw: string): string | undefined {
    const digits = raw.replace(/[^\d+]/g, "");
    return /^\+?\d{6,}$/.test(digits) ? digits : undefined;
}

/** Whether this is an account name a link can name, rather than an internal number. */
const isHandle = (value: string): boolean => /^[a-zA-Z][\w.]{2,}$/.test(value);

export interface AccountLink {
    /** Where it goes. */
    url: string;
    /** Which network it opens, for the label beside it. */
    network: string;
}

/**
 * The link that opens this account in the network's own app, if that network has one.
 *
 * `network` is the published network id (`telegram`, `whatsapp`, `signal`, `facebook`, `discord`), matched
 * case-insensitively because a display name ("WhatsApp") reaches here as well when no id was published.
 * Returns nothing rather than guessing: a link that lands on the wrong profile is worse than no link.
 */
export function accountLink(
    network: string,
    remoteId: string | undefined,
    identifiers: readonly string[] = [],
): AccountLink | undefined {
    const on = network.toLowerCase();
    const phone = identifiers
        .map((identifier) => (identifier.startsWith("tel:") ? number(identifier.slice(4)) : undefined))
        .find((found): found is string => !!found);
    const handle = identifiers
        .map((identifier) => identifier.split(":").slice(1).join(":"))
        .find((value) => value && isHandle(value));
    const named = remoteId && isHandle(remoteId) ? remoteId : handle;

    if (on.includes("telegram")) {
        // Telegram publishes no link for a numeric account: only a username can be addressed.
        return named ? { url: `https://t.me/${named}`, network } : undefined;
    }
    if (on.includes("whatsapp")) {
        const digits = phone ?? (remoteId ? number(remoteId) : undefined);
        return digits ? { url: `https://wa.me/${digits.replace("+", "")}`, network } : undefined;
    }
    if (on.includes("signal")) {
        // Signal addresses a person by number; its own id is an account UUID no link takes.
        return phone
            ? { url: `https://signal.me/#p/${phone.startsWith("+") ? phone : `+${phone}`}`, network }
            : undefined;
    }
    if (on.includes("facebook") || on.includes("messenger") || on.includes("instagram")) {
        return remoteId ? { url: `https://m.me/${remoteId}`, network } : undefined;
    }
    if (on.includes("discord")) {
        return remoteId && /^\d+$/.test(remoteId)
            ? { url: `https://discord.com/users/${remoteId}`, network }
            : undefined;
    }
    return undefined;
}
