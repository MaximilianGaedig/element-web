/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Editing what the reader knows about somebody.
 *
 * Every field a phone's address book has, because a card that can hold only some of them is a card people
 * keep somewhere else as well. What a network published is not edited here - that belongs to the network
 * and is shown beside this - so nothing the reader types can be overwritten by a bridge, and nothing a
 * bridge says can be silently replaced by a typo.
 *
 * Laid out as iOS lays out its contact editor: grouped blocks with a hairline between rows, and in every
 * group that can hold several of something a red minus before each entry to take it out and a green plus
 * row at the end to add one ("add phone"). A group with nothing in it is just its plus row, so an empty
 * card is short and a full one is exactly as long as what it holds. Entries left empty are dropped on save.
 */

/*
 * The rows here are keyed by position on purpose.
 *
 * A row being typed into has no stable identity - its value is the thing changing - so keying on the value
 * would unmount and remount the input on every keystroke and take the caret with it. Position is what
 * actually identifies a row in a form like this, which is the case the rule is not written for.
 */
/* oxlint-disable react/no-array-index-key */

import React, { type JSX, useState } from "react";
import { Button, Form } from "@vector-im/compound-web";
import ChevronIcon from "@vector-im/compound-design-tokens/assets/web/icons/chevron-down";

import { _t } from "../../../languageHandler";
import {
    ADDRESS_LABELS,
    type Address,
    type ContactCard,
    DATE_LABELS,
    type DatedValue,
    EMAIL_LABELS,
    type Handle,
    type Labelled,
    PHONE_LABELS,
    RELATED_LABELS,
    type Related,
    URL_LABELS,
} from "../../../utils/contacts/card";

/**
 * A text row: the name of the field is the placeholder, not a label stacked above it.
 *
 * A form of thirty fields, each a caption over a box with its own border and its own padding, is twice the
 * height it needs to be and reads as thirty separate things. A phone writes them as rows in a grouped
 * block - the field's name in the box until something is typed - so a card of ten facts is ten lines.
 */
function Field({
    label,
    value,
    onChange,
    type = "text",
    autoFocus,
}: {
    label: string;
    value?: string;
    onChange: (value: string) => void;
    type?: string;
    autoFocus?: boolean;
}): JSX.Element {
    return (
        <input
            className="mx_ContactEditor_input"
            type={type}
            value={value ?? ""}
            placeholder={label}
            aria-label={label}
            autoFocus={autoFocus}
            onChange={(event) => onChange(event.target.value)}
        />
    );
}

/**
 * A group that is not there until it is wanted: a line you press, which opens into its fields.
 *
 * For the groups that hold one of each thing (work, notes), where there is nothing to add or remove.
 */
function Group({
    title,
    filled,
    children,
}: {
    title: string;
    /** Whether it already holds something, in which case it opens with the form. */
    filled: boolean;
    children: React.ReactNode;
}): JSX.Element {
    const [open, setOpen] = useState(filled);
    return (
        <section className="mx_ContactEditor_group" aria-label={title} data-open={open || undefined}>
            <button
                type="button"
                className="mx_ContactEditor_groupHead"
                aria-expanded={open}
                onClick={() => setOpen((was) => !was)}
            >
                <span>{title}</span>
                <ChevronIcon width="20" height="20" aria-hidden />
            </button>
            {open && children}
        </section>
    );
}

/** The label a value carries, chosen from the usual ones or typed. */
function LabelPicker({
    value,
    options,
    onChange,
}: {
    value: string;
    options: string[];
    onChange: (label: string) => void;
}): JSX.Element {
    const known = options.includes(value);
    const [custom, setCustom] = useState(!known && !!value);
    return custom ? (
        <input
            className="mx_ContactEditor_label"
            value={value}
            aria-label={_t("contacts|field_label")}
            placeholder={_t("contacts|field_label")}
            onChange={(event) => onChange(event.target.value)}
        />
    ) : (
        <select
            className="mx_ContactEditor_label"
            value={known ? value : options[0]}
            aria-label={_t("contacts|field_label")}
            onChange={(event) => {
                if (event.target.value === "__custom") {
                    setCustom(true);
                    onChange("");
                } else onChange(event.target.value);
            }}
        >
            {options.map((one) => (
                <option key={one} value={one}>
                    {one}
                </option>
            ))}
            {/* iOS lets any label be typed, and vCard carries whatever it is given, so this does too. */}
            <option value="__custom">{_t("contacts|field_custom")}</option>
        </select>
    );
}

/**
 * A group of several of something - phones, emails, addresses - as iOS edits them.
 *
 * Each entry has a red minus before it that takes it out, and the group ends in a green plus row that adds
 * a blank one with the caret already in it. The new entry is focused because pressing "add phone" and then
 * having to find and press the box it made is two presses for one thing.
 */
function Repeated<T>({
    title,
    addLabel,
    items,
    blank,
    onChange,
    children,
}: {
    title: string;
    addLabel: string;
    items: T[];
    blank: () => T;
    onChange: (items: T[]) => void;
    /** One entry's fields: the entry, how to change it, and whether it was just added (to focus it). */
    children: (item: T, change: (next: T) => void, added: boolean) => React.ReactNode;
}): JSX.Element {
    const [added, setAdded] = useState<number>();
    return (
        <section className="mx_ContactEditor_group" aria-label={title}>
            {items.map((item, at) => (
                <div className="mx_ContactEditor_item" key={at}>
                    <button
                        type="button"
                        className="mx_ContactEditor_minus"
                        aria-label={_t("contacts|remove_field", { field: title })}
                        onClick={() => {
                            setAdded(undefined);
                            onChange(items.filter((_item, index) => index !== at));
                        }}
                    />
                    <div className="mx_ContactEditor_itemBody">
                        {children(
                            item,
                            (next) => onChange(items.map((one, index) => (index === at ? next : one))),
                            added === at,
                        )}
                    </div>
                </div>
            ))}
            <button
                type="button"
                className="mx_ContactEditor_add"
                onClick={() => {
                    setAdded(items.length);
                    onChange([...items, blank()]);
                }}
            >
                <span className="mx_ContactEditor_plus" aria-hidden />
                {addLabel}
            </button>
        </section>
    );
}

/** A label, a rule, and the value: one line of a labelled entry. */
function LabelledLine({
    labels,
    item,
    change,
    added,
    placeholder,
    type,
}: {
    labels: string[];
    item: Labelled;
    change: (next: Labelled) => void;
    added: boolean;
    placeholder: string;
    type?: string;
}): JSX.Element {
    return (
        <div className="mx_ContactEditor_labelled">
            <LabelPicker value={item.label} options={labels} onChange={(label) => change({ ...item, label })} />
            <Field
                label={placeholder}
                type={type}
                value={item.value}
                autoFocus={added}
                onChange={(value) => change({ ...item, value })}
            />
        </div>
    );
}

/** What a card keeps once it is saved: the entries that say something, and nothing left blank. */
function withoutBlanks(card: ContactCard): ContactCard {
    const keep = <T,>(rows: T[] | undefined, says: (row: T) => boolean): T[] | undefined => {
        const kept = rows?.filter(says);
        return kept?.length ? kept : undefined;
    };
    return {
        ...card,
        phones: keep(card.phones, (row) => !!row.value.trim()),
        emails: keep(card.emails, (row) => !!row.value.trim()),
        urls: keep(card.urls, (row) => !!row.value.trim()),
        addresses: keep(
            card.addresses,
            (row) => !!(row.street || row.city || row.state || row.postcode || row.country),
        ),
        dates: keep(card.dates, (row) => !!row.date),
        related: keep(card.related, (row) => !!row.name.trim()),
        messaging: keep(card.messaging, (row) => !!row.handle.trim()),
        social: keep(card.social, (row) => !!row.handle.trim()),
    };
}

interface Props {
    card: ContactCard;
    onSave: (card: ContactCard) => void;
    onCancel: () => void;
}

export function ContactEditor({ card, onSave, onCancel }: Props): JSX.Element {
    const [draft, setDraft] = useState<ContactCard>(card);
    const set = <K extends keyof ContactCard>(key: K, value: ContactCard[K]): void =>
        setDraft((was) => ({ ...was, [key]: value }));
    const text =
        <K extends keyof ContactCard>(key: K) =>
        (value: string): void =>
            set(key, (value.trim() ? value : undefined) as ContactCard[K]);

    const moreNameFilled = !!(
        draft.prefix ||
        draft.middleName ||
        draft.suffix ||
        draft.nickname ||
        draft.previousName ||
        draft.phoneticFirst ||
        draft.phoneticMiddle ||
        draft.phoneticLast ||
        draft.pronunciationFirst ||
        draft.pronunciationLast
    );
    const [moreName, setMoreName] = useState(moreNameFilled);

    return (
        <Form.Root
            className="mx_ContactEditor"
            onSubmit={(event) => {
                event.preventDefault();
                onSave(withoutBlanks(draft));
            }}
        >
            {/*
             * The two answers, at the top and always there.
             *
             * They were at the foot of a form that is taller than the screen, so saving meant scrolling
             * past every field to find the button - and cancelling meant the same journey to get out.
             */}
            <div className="mx_ContactEditor_bar">
                <Button kind="tertiary" size="md" type="button" onClick={onCancel}>
                    {_t("action|cancel")}
                </Button>
                <Button kind="primary" size="md" type="submit">
                    {_t("action|save")}
                </Button>
            </div>

            {/*
             * The name, as one block. The three a phone shows first, and the rest of the name's parts opening
             * inside the same block rather than as a group of their own: they are more of the name, and
             * splitting them off put "middle name" a whole section away from first and last.
             */}
            <section className="mx_ContactEditor_group" aria-label={_t("contacts|name")}>
                {moreName && <Field label={_t("contacts|prefix")} value={draft.prefix} onChange={text("prefix")} />}
                <Field label={_t("contacts|first_name")} value={draft.firstName} onChange={text("firstName")} />
                {moreName && (
                    <>
                        {/*
                         * The phonetic fields are not decoration: they are how a name is sorted and spoken in
                         * Japanese and Chinese address books, and a card that drops them cannot round-trip one.
                         */}
                        <Field
                            label={_t("contacts|phonetic_first")}
                            value={draft.phoneticFirst}
                            onChange={text("phoneticFirst")}
                        />
                        <Field
                            label={_t("contacts|middle_name")}
                            value={draft.middleName}
                            onChange={text("middleName")}
                        />
                        <Field
                            label={_t("contacts|phonetic_middle")}
                            value={draft.phoneticMiddle}
                            onChange={text("phoneticMiddle")}
                        />
                    </>
                )}
                <Field label={_t("contacts|last_name")} value={draft.lastName} onChange={text("lastName")} />
                {moreName && (
                    <>
                        <Field
                            label={_t("contacts|phonetic_last")}
                            value={draft.phoneticLast}
                            onChange={text("phoneticLast")}
                        />
                        <Field label={_t("contacts|suffix")} value={draft.suffix} onChange={text("suffix")} />
                        <Field label={_t("contacts|nickname")} value={draft.nickname} onChange={text("nickname")} />
                        <Field
                            label={_t("contacts|previous_name")}
                            value={draft.previousName}
                            onChange={text("previousName")}
                        />
                        <Field
                            label={_t("contacts|pronunciation_first")}
                            value={draft.pronunciationFirst}
                            onChange={text("pronunciationFirst")}
                        />
                        <Field
                            label={_t("contacts|pronunciation_last")}
                            value={draft.pronunciationLast}
                            onChange={text("pronunciationLast")}
                        />
                    </>
                )}
                <Field label={_t("contacts|company")} value={draft.company} onChange={text("company")} />
                {/* Folding them back is only offered while there is nothing in them to hide. */}
                {!(moreName && moreNameFilled) && (
                    <button
                        type="button"
                        className="mx_ContactEditor_groupHead"
                        aria-expanded={moreName}
                        onClick={() => setMoreName((was) => !was)}
                    >
                        <span>{moreName ? _t("contacts|fewer_name") : _t("contacts|more_name")}</span>
                        <ChevronIcon width="20" height="20" aria-hidden />
                    </button>
                )}
            </section>

            <Group title={_t("contacts|work")} filled={!!(draft.jobTitle || draft.department)}>
                <Field label={_t("contacts|job_title")} value={draft.jobTitle} onChange={text("jobTitle")} />
                <Field label={_t("contacts|department")} value={draft.department} onChange={text("department")} />
            </Group>

            {(
                [
                    ["phones", _t("contacts|phone"), _t("contacts|add_phone"), PHONE_LABELS, "tel"],
                    ["emails", _t("contacts|email"), _t("contacts|add_email"), EMAIL_LABELS, "email"],
                    ["urls", _t("contacts|url"), _t("contacts|add_url"), URL_LABELS, "url"],
                ] as const
            ).map(([key, title, addLabel, labels, type]) => (
                <Repeated<Labelled>
                    key={key}
                    title={title}
                    addLabel={addLabel}
                    items={draft[key] ?? []}
                    blank={() => ({ label: labels[0], value: "" })}
                    onChange={(rows) => set(key, rows)}
                >
                    {(item, change, added) => (
                        <LabelledLine
                            labels={[...labels]}
                            item={item}
                            change={change}
                            added={added}
                            placeholder={title}
                            type={type}
                        />
                    )}
                </Repeated>
            ))}

            <Repeated<Address>
                title={_t("contacts|address")}
                addLabel={_t("contacts|add_address")}
                items={draft.addresses ?? []}
                blank={() => ({ label: ADDRESS_LABELS[0] })}
                onChange={(rows) => set("addresses", rows)}
            >
                {(address, change, added) => (
                    <>
                        <LabelPicker
                            value={address.label}
                            options={ADDRESS_LABELS}
                            onChange={(label) => change({ ...address, label })}
                        />
                        <Field
                            label={_t("contacts|street")}
                            value={address.street}
                            autoFocus={added}
                            onChange={(street) => change({ ...address, street })}
                        />
                        <Field
                            label={_t("contacts|city")}
                            value={address.city}
                            onChange={(city) => change({ ...address, city })}
                        />
                        <Field
                            label={_t("contacts|state")}
                            value={address.state}
                            onChange={(state) => change({ ...address, state })}
                        />
                        <Field
                            label={_t("contacts|postcode")}
                            value={address.postcode}
                            onChange={(postcode) => change({ ...address, postcode })}
                        />
                        <Field
                            label={_t("contacts|country")}
                            value={address.country}
                            onChange={(country) => change({ ...address, country })}
                        />
                    </>
                )}
            </Repeated>

            {/*
             * A birthday is one, not several, but it is added and removed the same way: a plain date field,
             * since a birthday with no year is written `--MM-DD` in vCard, which a date input cannot express -
             * so a year is asked for, and the card keeps whichever form it was given when it came from
             * somewhere else.
             */}
            <Repeated<string>
                title={_t("contacts|birthday")}
                addLabel={_t("contacts|add_birthday")}
                items={draft.birthday !== undefined ? [draft.birthday] : []}
                blank={() => ""}
                onChange={(rows) => set("birthday", rows.length ? rows[0] : undefined)}
            >
                {(birthday, change, added) => (
                    <Field
                        label={_t("contacts|birthday")}
                        type="date"
                        value={birthday.startsWith("--") ? "" : birthday}
                        autoFocus={added}
                        onChange={change}
                    />
                )}
            </Repeated>

            <Repeated<DatedValue>
                title={_t("contacts|dates")}
                addLabel={_t("contacts|add_date")}
                items={draft.dates ?? []}
                blank={() => ({ label: DATE_LABELS[0], date: "" })}
                onChange={(rows) => set("dates", rows)}
            >
                {(dated, change, added) => (
                    <div className="mx_ContactEditor_labelled">
                        <LabelPicker
                            value={dated.label}
                            options={DATE_LABELS}
                            onChange={(label) => change({ ...dated, label })}
                        />
                        <Field
                            label={_t("contacts|dates")}
                            type="date"
                            value={dated.date}
                            autoFocus={added}
                            onChange={(date) => change({ ...dated, date })}
                        />
                    </div>
                )}
            </Repeated>

            <Repeated<Related>
                title={_t("contacts|related")}
                addLabel={_t("contacts|add_related")}
                items={draft.related ?? []}
                blank={() => ({ label: RELATED_LABELS[0], name: "" })}
                onChange={(rows) => set("related", rows)}
            >
                {(one, change, added) => (
                    <div className="mx_ContactEditor_labelled">
                        <LabelPicker
                            value={one.label}
                            options={RELATED_LABELS}
                            onChange={(label) => change({ ...one, label })}
                        />
                        <Field
                            label={_t("contacts|related_name")}
                            value={one.name}
                            autoFocus={added}
                            onChange={(name) => change({ ...one, name })}
                        />
                    </div>
                )}
            </Repeated>

            {/* Services with no bridge here: a Skype handle is still a fact about the person. */}
            {(
                [
                    ["messaging", _t("contacts|messaging"), _t("contacts|add_messaging")],
                    ["social", _t("contacts|social"), _t("contacts|add_social")],
                ] as const
            ).map(([key, title, addLabel]) => (
                <Repeated<Handle>
                    key={key}
                    title={title}
                    addLabel={addLabel}
                    items={draft[key] ?? []}
                    blank={() => ({ service: "", handle: "" })}
                    onChange={(rows) => set(key, rows)}
                >
                    {(one, change, added) => (
                        <div className="mx_ContactEditor_labelled">
                            <input
                                className="mx_ContactEditor_label"
                                value={one.service}
                                placeholder={_t("contacts|service")}
                                aria-label={`${title} ${_t("contacts|service")}`}
                                autoFocus={added}
                                onChange={(event) => change({ ...one, service: event.target.value })}
                            />
                            <Field
                                label={_t("contacts|handle")}
                                value={one.handle}
                                onChange={(handle) => change({ ...one, handle })}
                            />
                        </div>
                    )}
                </Repeated>
            ))}

            <Group title={_t("contacts|notes")} filled={!!draft.notes}>
                <textarea
                    className="mx_ContactEditor_notes"
                    value={draft.notes ?? ""}
                    aria-label={_t("contacts|notes")}
                    onChange={(event) => text("notes")(event.target.value)}
                />
            </Group>
        </Form.Root>
    );
}
