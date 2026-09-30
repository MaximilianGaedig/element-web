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
 * Rows are added by filling in the blank one at the end of each group rather than by pressing "add" first:
 * a list that grows as it is filled never has an empty row to tidy up, and there is nothing to press before
 * typing. Emptying a row removes it.
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
import DeleteIcon from "@vector-im/compound-design-tokens/assets/web/icons/delete";

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

/** A text field with its name above it, which is every field on this form. */
function Field({
    label,
    value,
    onChange,
    type = "text",
    placeholder,
}: {
    label: string;
    value?: string;
    onChange: (value: string) => void;
    type?: string;
    placeholder?: string;
}): JSX.Element {
    return (
        <label className="mx_ContactEditor_field">
            <span className="mx_ContactEditor_fieldLabel">{label}</span>
            <input
                type={type}
                value={value ?? ""}
                placeholder={placeholder}
                onChange={(event) => onChange(event.target.value)}
            />
        </label>
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
 * A group of labelled values - the phones, the emails, the links.
 *
 * Always one blank row at the end: that is the "add" affordance, and it means a new value is one tap and
 * then typing rather than a press, a menu and then typing.
 */
function LabelledRows({
    title,
    rows,
    labels,
    placeholder,
    type,
    onChange,
}: {
    title: string;
    rows: Labelled[];
    labels: string[];
    placeholder: string;
    type?: string;
    onChange: (rows: Labelled[]) => void;
}): JSX.Element {
    const shown = [...rows, { label: labels[0], value: "" }];
    const set = (at: number, next: Labelled): void =>
        onChange(shown.map((row, index) => (index === at ? next : row)).filter((row) => row.value.trim()));
    return (
        <section className="mx_ContactEditor_group" aria-label={title}>
            <h3>{title}</h3>
            {shown.map((row, at) => (
                <div className="mx_ContactEditor_row" key={at}>
                    <LabelPicker value={row.label} options={labels} onChange={(label) => set(at, { ...row, label })} />
                    <input
                        type={type ?? "text"}
                        value={row.value}
                        placeholder={placeholder}
                        aria-label={`${title} ${at + 1}`}
                        onChange={(event) => set(at, { ...row, value: event.target.value })}
                    />
                    {!!row.value && (
                        <button
                            type="button"
                            className="mx_ContactEditor_remove"
                            aria-label={_t("action|remove")}
                            onClick={() => onChange(rows.filter((_row, index) => index !== at))}
                        >
                            <DeleteIcon width="20" height="20" aria-hidden />
                        </button>
                    )}
                </div>
            ))}
        </section>
    );
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

    const addresses = [...(draft.addresses ?? []), { label: ADDRESS_LABELS[0] }];
    const setAddress = (at: number, next: Address): void =>
        set(
            "addresses",
            addresses
                .map((row, index) => (index === at ? next : row))
                .filter((row) => row.street || row.city || row.state || row.postcode || row.country),
        );

    const dates: DatedValue[] = [...(draft.dates ?? []), { label: DATE_LABELS[0], date: "" }];
    const related: Related[] = [...(draft.related ?? []), { label: RELATED_LABELS[0], name: "" }];
    const messaging: Handle[] = [...(draft.messaging ?? []), { service: "", handle: "" }];
    const social: Handle[] = [...(draft.social ?? []), { service: "", handle: "" }];

    return (
        <Form.Root
            className="mx_ContactEditor"
            onSubmit={(event) => {
                event.preventDefault();
                onSave(draft);
            }}
        >
            <section className="mx_ContactEditor_group" aria-label={_t("contacts|name")}>
                <h3>{_t("contacts|name")}</h3>
                <Field label={_t("contacts|prefix")} value={draft.prefix} onChange={text("prefix")} />
                <Field label={_t("contacts|first_name")} value={draft.firstName} onChange={text("firstName")} />
                {/*
                 * The phonetic fields are not decoration: they are how a name is sorted and spoken in
                 * Japanese and Chinese address books, and a card that drops them cannot round-trip one.
                 */}
                <Field
                    label={_t("contacts|phonetic_first")}
                    value={draft.phoneticFirst}
                    onChange={text("phoneticFirst")}
                />
                <Field label={_t("contacts|middle_name")} value={draft.middleName} onChange={text("middleName")} />
                <Field
                    label={_t("contacts|phonetic_middle")}
                    value={draft.phoneticMiddle}
                    onChange={text("phoneticMiddle")}
                />
                <Field label={_t("contacts|last_name")} value={draft.lastName} onChange={text("lastName")} />
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
            </section>

            <section className="mx_ContactEditor_group" aria-label={_t("contacts|work")}>
                <h3>{_t("contacts|work")}</h3>
                <Field label={_t("contacts|company")} value={draft.company} onChange={text("company")} />
                <Field label={_t("contacts|job_title")} value={draft.jobTitle} onChange={text("jobTitle")} />
                <Field label={_t("contacts|department")} value={draft.department} onChange={text("department")} />
            </section>

            <LabelledRows
                title={_t("contacts|phone")}
                rows={draft.phones ?? []}
                labels={PHONE_LABELS}
                placeholder={_t("contacts|phone")}
                type="tel"
                onChange={(rows) => set("phones", rows)}
            />
            <LabelledRows
                title={_t("contacts|email")}
                rows={draft.emails ?? []}
                labels={EMAIL_LABELS}
                placeholder={_t("contacts|email")}
                type="email"
                onChange={(rows) => set("emails", rows)}
            />
            <LabelledRows
                title={_t("contacts|url")}
                rows={draft.urls ?? []}
                labels={URL_LABELS}
                placeholder={_t("contacts|url")}
                type="url"
                onChange={(rows) => set("urls", rows)}
            />

            <section className="mx_ContactEditor_group" aria-label={_t("contacts|address")}>
                <h3>{_t("contacts|address")}</h3>
                {addresses.map((address, at) => (
                    <div className="mx_ContactEditor_address" key={at}>
                        <LabelPicker
                            value={address.label}
                            options={ADDRESS_LABELS}
                            onChange={(label) => setAddress(at, { ...address, label })}
                        />
                        <Field
                            label={_t("contacts|street")}
                            value={address.street}
                            onChange={(street) => setAddress(at, { ...address, street })}
                        />
                        <Field
                            label={_t("contacts|city")}
                            value={address.city}
                            onChange={(city) => setAddress(at, { ...address, city })}
                        />
                        <Field
                            label={_t("contacts|state")}
                            value={address.state}
                            onChange={(state) => setAddress(at, { ...address, state })}
                        />
                        <Field
                            label={_t("contacts|postcode")}
                            value={address.postcode}
                            onChange={(postcode) => setAddress(at, { ...address, postcode })}
                        />
                        <Field
                            label={_t("contacts|country")}
                            value={address.country}
                            onChange={(country) => setAddress(at, { ...address, country })}
                        />
                    </div>
                ))}
            </section>

            <section className="mx_ContactEditor_group" aria-label={_t("contacts|birthday")}>
                <h3>{_t("contacts|birthday")}</h3>
                {/*
                 * A plain date field: a birthday with no year is written `--MM-DD` in vCard, which a date
                 * input cannot express, so a year is asked for and the card keeps whichever form it was
                 * given when it came from somewhere else.
                 */}
                <Field
                    label={_t("contacts|birthday")}
                    type="date"
                    value={draft.birthday?.startsWith("--") ? "" : draft.birthday}
                    onChange={text("birthday")}
                />
                {dates.map((dated, at) => (
                    <div className="mx_ContactEditor_row" key={at}>
                        <LabelPicker
                            value={dated.label}
                            options={DATE_LABELS}
                            onChange={(label) =>
                                set(
                                    "dates",
                                    dates
                                        .map((row, index) => (index === at ? { ...row, label } : row))
                                        .filter((row) => row.date),
                                )
                            }
                        />
                        <input
                            type="date"
                            value={dated.date}
                            aria-label={`${_t("contacts|dates")} ${at + 1}`}
                            onChange={(event) =>
                                set(
                                    "dates",
                                    dates
                                        .map((row, index) =>
                                            index === at ? { ...row, date: event.target.value } : row,
                                        )
                                        .filter((row) => row.date),
                                )
                            }
                        />
                    </div>
                ))}
            </section>

            <section className="mx_ContactEditor_group" aria-label={_t("contacts|related")}>
                <h3>{_t("contacts|related")}</h3>
                {related.map((one, at) => (
                    <div className="mx_ContactEditor_row" key={at}>
                        <LabelPicker
                            value={one.label}
                            options={RELATED_LABELS}
                            onChange={(label) =>
                                set(
                                    "related",
                                    related
                                        .map((row, index) => (index === at ? { ...row, label } : row))
                                        .filter((row) => row.name.trim()),
                                )
                            }
                        />
                        <input
                            value={one.name}
                            placeholder={_t("contacts|related_name")}
                            aria-label={`${_t("contacts|related")} ${at + 1}`}
                            onChange={(event) =>
                                set(
                                    "related",
                                    related
                                        .map((row, index) =>
                                            index === at ? { ...row, name: event.target.value } : row,
                                        )
                                        .filter((row) => row.name.trim()),
                                )
                            }
                        />
                    </div>
                ))}
            </section>

            {/* Services with no bridge here: a Skype handle is still a fact about the person. */}
            {(
                [
                    ["messaging", messaging, _t("contacts|messaging")],
                    ["social", social, _t("contacts|social")],
                ] as const
            ).map(([key, rows, title]) => (
                <section className="mx_ContactEditor_group" aria-label={title} key={key}>
                    <h3>{title}</h3>
                    {rows.map((one, at) => (
                        <div className="mx_ContactEditor_row" key={at}>
                            <input
                                className="mx_ContactEditor_label"
                                value={one.service}
                                placeholder={_t("contacts|service")}
                                aria-label={`${title} ${at + 1} ${_t("contacts|service")}`}
                                onChange={(event) =>
                                    set(
                                        key,
                                        rows
                                            .map((row, index) =>
                                                index === at ? { ...row, service: event.target.value } : row,
                                            )
                                            .filter((row) => row.handle.trim()),
                                    )
                                }
                            />
                            <input
                                value={one.handle}
                                placeholder={_t("contacts|handle")}
                                aria-label={`${title} ${at + 1}`}
                                onChange={(event) =>
                                    set(
                                        key,
                                        rows
                                            .map((row, index) =>
                                                index === at ? { ...row, handle: event.target.value } : row,
                                            )
                                            .filter((row) => row.handle.trim()),
                                    )
                                }
                            />
                        </div>
                    ))}
                </section>
            ))}

            <section className="mx_ContactEditor_group" aria-label={_t("contacts|notes")}>
                <h3>{_t("contacts|notes")}</h3>
                <textarea
                    className="mx_ContactEditor_notes"
                    value={draft.notes ?? ""}
                    aria-label={_t("contacts|notes")}
                    onChange={(event) => text("notes")(event.target.value)}
                />
            </section>

            <div className="mx_ContactEditor_actions">
                {/* Without type="button" this would submit the form it sits in, which is a save. */}
                <Button kind="secondary" size="md" type="button" onClick={onCancel}>
                    {_t("action|cancel")}
                </Button>
                <Button kind="primary" size="md" type="submit">
                    {_t("action|save")}
                </Button>
            </div>
        </Form.Root>
    );
}
