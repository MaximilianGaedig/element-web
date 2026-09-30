/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Reading and writing vCards.
 *
 * vCard is how address books hand people to each other: it is what iOS and Android share, what Contacts
 * exports, and what every CardDAV server stores. Supporting it is what stops this contact list being a
 * dead end - a card typed here can be sent to a phone, and a phone's whole address book can be brought in.
 *
 * Written against RFC 6350 (vCard 4.0) and read tolerantly enough for 3.0, which is what most things still
 * export: the differences that matter are the version line, `TYPE=` values being upper case in 3.0, and
 * 4.0 preferring `PREF=1` where 3.0 wrote `TYPE=PREF`. Both are folded the same way (RFC 6350 §3.2: a line
 * longer than 75 octets continues on the next line, which begins with a space), and unfolding before
 * parsing is the single thing most hand-written parsers get wrong.
 *
 * Nothing here escapes to the DOM and nothing is executed: a card is text in and text out, which is the
 * whole of what a file dropped in by the reader should ever be able to do.
 */

import {
    ADDRESS_LABELS,
    type ContactCard,
    DATE_LABELS,
    EMAIL_LABELS,
    PHONE_LABELS,
    RELATED_LABELS,
    URL_LABELS,
    fullName,
} from "./card";

/** Unfold the continuation lines vCard wraps long values onto (RFC 6350 §3.2). */
function unfold(text: string): string[] {
    const lines: string[] = [];
    for (const raw of text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
        if ((raw.startsWith(" ") || raw.startsWith("\t")) && lines.length) lines[lines.length - 1] += raw.slice(1);
        else lines.push(raw);
    }
    return lines.filter((line) => line.trim());
}

/** The escaping vCard applies inside a value: `\n`, and literal commas, semicolons and backslashes. */
const unescape = (value: string): string =>
    value.replace(/\\([\\,;nN])/g, (_all, char) => (char === "n" || char === "N" ? "\n" : char));

const escape = (value: string): string => value.replace(/([\\,;])/g, "\\$1").replace(/\n/g, "\\n");

interface Line {
    name: string;
    params: Record<string, string[]>;
    value: string;
}

/**
 * One line, split into its name, its parameters and its value.
 *
 * The colon that ends the name and parameters can also appear inside a quoted parameter (`TYPE="a:b"`), so
 * the split walks the line rather than taking the first colon - a URL in a parameter would otherwise cut
 * the line in the wrong place.
 */
function parseLine(line: string): Line | undefined {
    let at = 0;
    let quoted = false;
    for (; at < line.length; at++) {
        const char = line[at];
        if (char === '"') quoted = !quoted;
        else if (char === ":" && !quoted) break;
    }
    if (at >= line.length) return undefined;
    const head = line.slice(0, at);
    const value = line.slice(at + 1);
    const parts = head.split(";");
    // A property can be prefixed with a group ("item1.TEL"), which nothing here needs but must not confuse it.
    const name = parts[0].split(".").pop()!.toUpperCase();
    const params: Record<string, string[]> = {};
    for (const part of parts.slice(1)) {
        const eq = part.indexOf("=");
        // vCard 2.1 wrote bare types ("TEL;HOME:"), so a parameter with no `=` is a TYPE.
        const key = (eq === -1 ? "TYPE" : part.slice(0, eq)).toUpperCase();
        const raw = eq === -1 ? part : part.slice(eq + 1);
        const values = raw
            .split(",")
            .map((one) => one.replace(/^"|"$/g, "").trim())
            .filter(Boolean);
        params[key] = [...(params[key] ?? []), ...values];
    }
    return { name, params, value };
}

/** The label to show for a line: its own TYPE, minus the bookkeeping types that are not labels. */
function labelOf(line: Line, fallback: string): string {
    // X-ABLabel carries what iOS calls a custom label; it arrives as its own line and is applied by group.
    const type = (line.params.TYPE ?? []).find(
        (one) => !["PREF", "INTERNET", "VOICE", "X-INTERNET"].includes(one.toUpperCase()),
    );
    return type?.toLowerCase() || fallback;
}

/** Split on unescaped semicolons, which is how vCard separates the parts of a structured value. */
function parts(value: string): string[] {
    const out: string[] = [];
    let current = "";
    for (let at = 0; at < value.length; at++) {
        if (value[at] === "\\") {
            current += value[at] + (value[at + 1] ?? "");
            at++;
        } else if (value[at] === ";") {
            out.push(current);
            current = "";
        } else current += value[at];
    }
    out.push(current);
    return out.map(unescape);
}

/**
 * The cards in a vCard file, which may hold any number of them.
 *
 * Anything it does not understand is skipped rather than refused: a file from an address book with its own
 * extensions is still mostly people, and dropping the whole import over one unknown line would be the
 * wrong trade for the reader.
 */
export function parseVCards(text: string): ContactCard[] {
    const cards: ContactCard[] = [];
    let card: ContactCard | undefined;
    /** X-ABLabel lines name the group they belong to, so the values are held until the labels are known. */
    let groups: Record<string, string> = {};
    let pending: { group?: string; apply: (label?: string) => void }[] = [];
    /*
     * FN is held until the card ends rather than used where it appears.
     *
     * It is the whole name as one string, which is only worth having when N said nothing - and files put
     * the two in either order. Applied inline, an FN that came first filled in the first name and then
     * blocked N from correcting it, so a card written here and read straight back said "Ada Lovelace Ada
     * Lovelace".
     */
    let fullNameLine: string | undefined;
    /* The X-ABLabel lines seen, so the ones whose group nothing claimed can be carried through. */
    let labelLines: { group: string; raw: string }[] = [];

    const finish = (): void => {
        if (!card) return;
        const claimed = new Set(pending.map((one) => one.group).filter((one): one is string => !!one));
        for (const one of pending) one.apply(one.group ? groups[one.group] : undefined);
        for (const { group, raw } of labelLines) {
            if (!claimed.has(group)) card.extra = [...(card.extra ?? []), raw];
        }
        if (fullNameLine && !card.firstName && !card.lastName) card.firstName = fullNameLine;
        cards.push(card);
        card = undefined;
        groups = {};
        pending = [];
        fullNameLine = undefined;
        labelLines = [];
    };

    for (const raw of unfold(text)) {
        const upper = raw.toUpperCase();
        if (upper.startsWith("BEGIN:VCARD")) {
            card = {};
            groups = {};
            pending = [];
            fullNameLine = undefined;
            labelLines = [];
            continue;
        }
        if (upper.startsWith("END:VCARD")) {
            finish();
            continue;
        }
        if (!card) continue;
        const line = parseLine(raw);
        if (!line) continue;
        const group = raw.includes(".") ? raw.split(/[.;:]/)[0].toLowerCase() : undefined;
        const held = card;
        const value = unescape(line.value).trim();
        if (!value) continue;

        switch (line.name) {
            case "N": {
                const [last, first, middle, prefix, suffix] = parts(line.value);
                held.lastName ||= last || undefined;
                held.firstName ||= first || undefined;
                held.middleName ||= middle || undefined;
                held.prefix ||= prefix || undefined;
                held.suffix ||= suffix || undefined;
                break;
            }
            case "FN":
                // Only when N said nothing: a full name split back into parts is a guess, and N is the truth.
                fullNameLine = value;
                break;
            case "NICKNAME":
                held.nickname = value;
                break;
            /*
             * How a name is said, which is how it sorts and is spoken in Japanese and Chinese address
             * books. There is no standard property for it: Apple and Google both write these X- ones, and
             * a card that drops them cannot round-trip a contact from either.
             */
            case "X-PHONETIC-FIRST-NAME":
                held.phoneticFirst = value;
                break;
            case "X-PHONETIC-MIDDLE-NAME":
                held.phoneticMiddle = value;
                break;
            case "X-PHONETIC-LAST-NAME":
                held.phoneticLast = value;
                break;
            case "X-PHONETIC-ORG":
                break;
            /* How it is said, which Apple keeps apart from how it sorts. */
            case "X-PRONUNCIATION-FIRST-NAME":
                held.pronunciationFirst = value;
                break;
            case "X-PRONUNCIATION-LAST-NAME":
                held.pronunciationLast = value;
                break;
            case "X-ABDATE":
                pending.push({
                    group,
                    apply: (label) =>
                        (held.dates = [
                            ...(held.dates ?? []),
                            { label: label ?? labelOf(line, "other"), date: normaliseDate(value) },
                        ]),
                });
                break;
            case "X-MAIDENNAME":
                held.previousName = value;
                break;
            case "ORG": {
                const [company, department] = parts(line.value);
                held.company ||= company || undefined;
                held.department ||= department || undefined;
                break;
            }
            case "TITLE":
                held.jobTitle = value;
                break;
            case "TEL":
                pending.push({
                    group,
                    apply: (label) =>
                        (held.phones = [
                            ...(held.phones ?? []),
                            { label: label ?? labelOf(line, "mobile"), value: value.replace(/^tel:/i, "") },
                        ]),
                });
                break;
            case "EMAIL":
                pending.push({
                    group,
                    apply: (label) =>
                        (held.emails = [...(held.emails ?? []), { label: label ?? labelOf(line, "home"), value }]),
                });
                break;
            case "URL":
                pending.push({
                    group,
                    apply: (label) =>
                        (held.urls = [...(held.urls ?? []), { label: label ?? labelOf(line, "homepage"), value }]),
                });
                break;
            case "ADR": {
                // ADR is post-office box; extended; street; locality; region; postcode; country.
                const [, , street, city, state, postcode, country] = parts(line.value);
                pending.push({
                    group,
                    apply: (label) =>
                        (held.addresses = [
                            ...(held.addresses ?? []),
                            {
                                label: label ?? labelOf(line, "home"),
                                street: street || undefined,
                                city: city || undefined,
                                state: state || undefined,
                                postcode: postcode || undefined,
                                country: country || undefined,
                            },
                        ]),
                });
                break;
            }
            case "BDAY":
                held.birthday = normaliseDate(value);
                break;
            case "ANNIVERSARY":
                held.dates = [...(held.dates ?? []), { label: "anniversary", date: normaliseDate(value) }];
                break;
            case "RELATED":
                pending.push({
                    group,
                    apply: (label) =>
                        (held.related = [
                            ...(held.related ?? []),
                            { label: label ?? labelOf(line, "other"), name: value.replace(/^name:/i, "") },
                        ]),
                });
                break;
            case "IMPP":
                held.messaging = [
                    ...(held.messaging ?? []),
                    {
                        service: value.split(":")[0] || labelOf(line, "chat"),
                        handle: value.split(":").slice(1).join(":") || value,
                    },
                ];
                break;
            case "X-SOCIALPROFILE":
                held.social = [
                    ...(held.social ?? []),
                    { service: line.params.TYPE?.[0]?.toLowerCase() ?? "profile", handle: value, url: value },
                ];
                break;
            case "NOTE":
                held.notes = value;
                break;
            case "X-ABLABEL":
                // Applies to whichever group it names; iOS writes "_$!<Home>!$_" for its built-in labels.
                if (group) {
                    groups[group] = value.replace(/^_\$!<|>!\$_$/g, "").toLowerCase();
                    labelLines.push({ group, raw });
                } else held.extra = [...(held.extra ?? []), raw];
                break;
            case "VERSION":
            case "PRODID":
            case "REV":
            case "UID":
                // Bookkeeping the writer regenerates; carrying it through would be carrying a stale claim.
                break;
            default:
                // Anything else belongs to whoever wrote the file, and goes back out exactly as it came in.
                held.extra = [...(held.extra ?? []), raw];
                break;
        }
    }
    // A file whose last card has no END line is still a card.
    finish();
    return cards;
}

/** `19850304`, `1985-03-04` and `--0304` all mean a day; keep the shape vCard 4.0 writes. */
function normaliseDate(value: string): string {
    const digits = value.replace(/-/g, "");
    if (/^\d{8}$/.test(digits)) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
    if (/^\d{4}$/.test(digits) && value.startsWith("--")) return `--${digits.slice(0, 2)}-${digits.slice(2, 4)}`;
    return value;
}

const line = (name: string, value: string, params: string = ""): string => `${name}${params}:${escape(value)}`;

/** A TYPE parameter, when the label is one vCard can carry as a type rather than as a custom label. */
const typeParam = (label: string): string => (label ? `;TYPE=${label.replace(/[;:,]/g, "")}` : "");

/**
 * A labelled value, written the way it came in.
 *
 * A label that is one of the standard types is a TYPE parameter. Anything else - "dad's landline", "iCloud",
 * whatever the reader typed - is written as its own group with an X-ABLabel line beside it, which is what
 * iOS does and the only form that survives being read back by it. Flattening those into `TYPE=dad's
 * landline` lost the X-ABLabel property and produced a parameter with spaces and an apostrophe in it, which
 * is not a type any reader is obliged to keep.
 */
function labelled(name: string, value: string, label: string, standard: string[], group: number): string[] {
    if (!label || standard.includes(label.toLowerCase())) return [line(name, value, typeParam(label))];
    const item = `item${group}`;
    return [`${item}.${line(name, value)}`, `${item}.X-ABLabel:${escape(label)}`];
}

/**
 * One card as vCard 4.0.
 *
 * 4.0 rather than 3.0 because it is the current standard, it is what iOS reads, and its date handling is
 * the one that can say "a birthday with no year" without an extension.
 */
export function toVCard(card: ContactCard, extra: { photoUrl?: string } = {}): string {
    const out: string[] = ["BEGIN:VCARD", "VERSION:4.0"];
    const name = fullName(card) || card.nickname || "";
    if (name) out.push(line("FN", name));
    /*
     * Built here rather than through line(), which escapes what it is given: the semicolons between the
     * parts of a structured value are structure, and escaping them again turned the whole name into one
     * field - so a card written and read straight back had "Lovelace;Ada;;;" as its surname.
     */
    out.push(
        "N:" +
            [card.lastName ?? "", card.firstName ?? "", card.middleName ?? "", card.prefix ?? "", card.suffix ?? ""]
                .map(escape)
                .join(";"),
    );
    if (card.nickname) out.push(line("NICKNAME", card.nickname));
    if (card.phoneticFirst) out.push(line("X-PHONETIC-FIRST-NAME", card.phoneticFirst));
    if (card.phoneticMiddle) out.push(line("X-PHONETIC-MIDDLE-NAME", card.phoneticMiddle));
    if (card.phoneticLast) out.push(line("X-PHONETIC-LAST-NAME", card.phoneticLast));
    if (card.previousName) out.push(line("X-MAIDENNAME", card.previousName));
    if (card.pronunciationFirst) out.push(line("X-PRONUNCIATION-FIRST-NAME", card.pronunciationFirst));
    if (card.pronunciationLast) out.push(line("X-PRONUNCIATION-LAST-NAME", card.pronunciationLast));
    if (card.company || card.department) out.push(`ORG:${escape(card.company ?? "")};${escape(card.department ?? "")}`);
    if (card.jobTitle) out.push(line("TITLE", card.jobTitle));
    /* Groups are numbered across the whole card, because that is what makes each X-ABLabel find its value. */
    let group = 0;
    for (const phone of card.phones ?? [])
        out.push(...labelled("TEL", phone.value, phone.label, PHONE_LABELS, ++group));
    for (const email of card.emails ?? []) {
        out.push(...labelled("EMAIL", email.value, email.label, EMAIL_LABELS, ++group));
    }
    for (const url of card.urls ?? []) out.push(...labelled("URL", url.value, url.label, URL_LABELS, ++group));
    for (const address of card.addresses ?? []) {
        const custom = address.label && !ADDRESS_LABELS.includes(address.label.toLowerCase());
        const item = custom ? `item${++group}.` : "";
        const value = [
            "",
            "",
            address.street ?? "",
            address.city ?? "",
            address.state ?? "",
            address.postcode ?? "",
            address.country ?? "",
        ]
            .map(escape)
            .join(";");
        out.push(`${item}ADR${custom ? "" : typeParam(address.label)}:${value}`);
        if (custom) out.push(`${item}X-ABLabel:${escape(address.label)}`);
    }
    if (card.birthday) out.push(line("BDAY", card.birthday));
    for (const dated of card.dates ?? []) {
        if (dated.label === "anniversary") out.push(line("ANNIVERSARY", dated.date));
        else out.push(...labelled("X-ABDATE", dated.date, dated.label, DATE_LABELS, ++group));
    }
    for (const related of card.related ?? []) {
        out.push(...labelled("RELATED", related.name, related.label, RELATED_LABELS, ++group));
    }
    for (const handle of card.messaging ?? []) out.push(line("IMPP", `${handle.service}:${handle.handle}`));
    for (const profile of card.social ?? []) {
        out.push(line("X-SOCIALPROFILE", profile.url ?? profile.handle, typeParam(profile.service)));
    }
    if (card.notes) out.push(line("NOTE", card.notes));
    if (extra.photoUrl ?? card.photoUrl) out.push(line("PHOTO", (extra.photoUrl ?? card.photoUrl)!));
    // Verbatim, and last, so nothing this client wrote can be confused with what it was merely carrying.
    for (const raw of card.extra ?? []) out.push(raw);
    out.push("END:VCARD");
    return foldAll(out).join("\r\n") + "\r\n";
}

/** Fold every line to 75 octets, which is what the format asks for and what strict readers expect. */
function foldAll(lines: string[]): string[] {
    const folded: string[] = [];
    for (const one of lines) {
        if (one.length <= 75) {
            folded.push(one);
            continue;
        }
        folded.push(one.slice(0, 75));
        for (let at = 75; at < one.length; at += 74) folded.push(" " + one.slice(at, at + 74));
    }
    return folded;
}

/** Several cards in one file, which is how a whole address book travels. */
export const toVCards = (cards: ContactCard[]): string => cards.map((card) => toVCard(card)).join("");

/**
 * A vCard built from everything known about a person: what the reader wrote, and what the networks say.
 *
 * Both, because a card exported with only the reader's own additions would be missing the number the
 * bridge published - which is usually the only number there is. The reader's own values win where the two
 * disagree, since those are the ones they typed.
 */
export function cardForExport(
    person: { name: string; details: readonly { kind: string; value: string }[] },
    card: ContactCard = {},
): ContactCard {
    const published = {
        phones: [] as { label: string; value: string }[],
        emails: [] as { label: string; value: string }[],
    };
    for (const detail of person.details) {
        if (detail.kind === "phone") published.phones.push({ label: "mobile", value: detail.value });
        if (detail.kind === "email") published.emails.push({ label: "home", value: detail.value });
    }
    const known = (rows: { value: string }[] = []): Set<string> => new Set(rows.map((row) => row.value));
    const mine = known(card.phones);
    const myEmails = known(card.emails);
    return {
        ...card,
        // Somebody with no card at all still exports under the name the networks know them by.
        firstName: card.firstName ?? (card.lastName ? undefined : person.name),
        phones: [...(card.phones ?? []), ...published.phones.filter((row) => !mine.has(row.value))],
        emails: [...(card.emails ?? []), ...published.emails.filter((row) => !myEmails.has(row.value))],
    };
}

/**
 * Hands a vCard to whatever the reader wants to do with it.
 *
 * The platform's own share sheet where there is one - which is how a contact reaches another app, another
 * phone or a message on a handset - and a download where there is not. `canShare` is checked with the
 * actual file, because a browser can support sharing text and refuse to share files.
 */
export async function shareVCard(filename: string, text: string): Promise<void> {
    const file = new File([text], filename.replace(/[^\w. -]+/g, "_") || "contact.vcf", { type: "text/vcard" });
    if (navigator.canShare?.({ files: [file] })) {
        try {
            await navigator.share({ files: [file], title: filename });
            return;
        } catch {
            // Dismissed, or refused by the platform: fall through to the file, never leave them with nothing.
        }
    }
    downloadVCard(filename, text);
}

/** Hands a vCard to the browser as a file, which is the only way out of a web client. */
export function downloadVCard(filename: string, text: string): void {
    const blob = new Blob([text], { type: "text/vcard;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename.replace(/[^\w. -]+/g, "_") || "contacts.vcf";
    document.body.append(link);
    link.click();
    link.remove();
    // Freed on the next turn of the loop: revoking it straight away can beat the download starting.
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
