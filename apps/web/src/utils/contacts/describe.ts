/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * A card read out as plain rows, for showing one that is not the current one.
 *
 * The card view proper is built around a live person - their accounts, their presence, their chats - and none
 * of that applies to a version out of the history: what is being shown there is only what the fields said at
 * the time. So this turns a card into labelled lines, in the order the editor puts them in, and leaves the
 * empty ones out.
 *
 * It is also what says which lines differ from the card in force now, which is the question somebody opening
 * an old version actually has.
 */

import { _t } from "../../languageHandler";
import { type Address, type ContactCard, type DatedValue, type Handle, type Labelled, type Related } from "./card";

export interface Line {
    /** Which field this came from, so a line can be compared with the same line of another card. */
    key: string;
    label: string;
    value: string;
}

/** The plain fields, in the order the editor shows them, and what to call each. */
const SIMPLE: [keyof ContactCard, string][] = [
    ["prefix", "contacts|prefix"],
    ["firstName", "contacts|first_name"],
    ["phoneticFirst", "contacts|phonetic_first"],
    ["middleName", "contacts|middle_name"],
    ["phoneticMiddle", "contacts|phonetic_middle"],
    ["lastName", "contacts|last_name"],
    ["phoneticLast", "contacts|phonetic_last"],
    ["suffix", "contacts|suffix"],
    ["nickname", "contacts|nickname"],
    ["previousName", "contacts|previous_name"],
    ["pronunciationFirst", "contacts|pronunciation_first"],
    ["pronunciationLast", "contacts|pronunciation_last"],
    ["jobTitle", "contacts|job_title"],
    ["department", "contacts|department"],
    ["company", "contacts|company"],
    ["birthday", "contacts|birthday"],
    ["notes", "contacts|notes"],
];

/** An address as one line, in the order it would be written on an envelope. */
const addressLine = (address: Address): string =>
    [address.street, address.city, address.state, address.postcode, address.country].filter(Boolean).join(", ");

/**
 * Everything the card says, as labelled lines.
 *
 * A repeated field contributes one line per entry, keyed by its position, so "the second phone number
 * changed" is a change to one line rather than to the whole list of numbers.
 */
export function describeCard(card: ContactCard): Line[] {
    const lines: Line[] = [];
    const add = (key: string, label: string, value?: string): void => {
        if (value) lines.push({ key, label, value });
    };

    for (const [field, label] of SIMPLE) add(field, _t(label), card[field] as string | undefined);

    const labelled = (field: "phones" | "emails" | "urls", fallback: string): void =>
        (card[field] ?? []).forEach((one: Labelled, index) =>
            add(`${field}.${index}`, one.label || _t(fallback), one.value),
        );
    labelled("phones", "contacts|phone");
    labelled("emails", "contacts|email");
    labelled("urls", "contacts|url");

    (card.addresses ?? []).forEach((one: Address, index) =>
        add(`addresses.${index}`, one.label || _t("contacts|address"), addressLine(one)),
    );
    (card.dates ?? []).forEach((one: DatedValue, index) =>
        add(`dates.${index}`, one.label || _t("contacts|dates"), one.date),
    );
    (card.related ?? []).forEach((one: Related, index) =>
        add(`related.${index}`, one.label || _t("contacts|related"), one.name),
    );
    const handles = (field: "social" | "messaging", fallback: string): void =>
        (card[field] ?? []).forEach((one: Handle, index) =>
            add(`${field}.${index}`, one.service || _t(fallback), one.handle),
        );
    handles("social", "contacts|social");
    handles("messaging", "contacts|messaging");

    /*
     * The properties an imported card came with that this client does not understand are counted, not listed:
     * they are carried verbatim precisely because nothing here knows what they mean, so printing them would
     * be printing another address book's internals at somebody reading their own contact.
     */
    if (card.extra?.length) add("extra", _t("contacts|other_fields"), String(card.extra.length));

    return lines;
}

/** Which of these lines say something different from the card in force now, keyed as `describeCard` keys. */
export function differingKeys(shown: Line[], against: ContactCard): Set<string> {
    const now = new Map(describeCard(against).map((line) => [line.key, line.value]));
    const differing = new Set<string>();
    for (const line of shown) if (now.get(line.key) !== line.value) differing.add(line.key);
    return differing;
}
