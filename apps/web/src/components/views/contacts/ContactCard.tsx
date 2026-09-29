/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * One person, as a card.
 *
 * Shaped after the iOS contact card, because that shape carries the one thing a merged contact has to
 * say and a row cannot: that this is one person on several networks. So the face and name sit at the
 * top, the things you can do to them are round buttons under it, and everything known about them is
 * grouped below - a section per kind, each row a fact with its label beside it.
 *
 * What is editable here is what is ours to edit. The numbers and names come from the networks and
 * writing them back is their business, not ours; the name the reader gives them, and whether these
 * accounts are one person at all, are decisions made here and kept with the account.
 */

import React, { type JSX, useState } from "react";
import { Button, IconButton, Form } from "@vector-im/compound-web";
import BackIcon from "@vector-im/compound-design-tokens/assets/web/icons/chevron-left";
import ChatIcon from "@vector-im/compound-design-tokens/assets/web/icons/chat";
import VoiceCallIcon from "@vector-im/compound-design-tokens/assets/web/icons/voice-call";
import VideoCallIcon from "@vector-im/compound-design-tokens/assets/web/icons/video-call";
import EditIcon from "@vector-im/compound-design-tokens/assets/web/icons/edit";

import { _t } from "../../../languageHandler";
import { type Person } from "../../../utils/contacts/people";
import { readKey } from "../../../utils/contacts/identity";
import BaseAvatar from "../avatars/BaseAvatar";
import { mediaFromMxc } from "../../../customisations/Media";

interface Props {
    person: Person;
    /** Back to the list. */
    onBack: () => void;
    /** Open the chat with them, on the account given or on whichever one can. */
    onMessage: (person: Person, mxid?: string) => void;
    /** Place a call, where the chat that would carry it exists. */
    onCall?: (person: Person, video: boolean) => void;
    /** Undo a merge the reader made; absent when there is no merge of theirs to undo. */
    onSeparate?: (person: Person) => void;
    /** The name the reader gave them, if they gave one, and how to change it. */
    nickname?: string;
    onRename?: (person: Person, name: string) => void;
}

/** A row of the card: what it is on the left, what it says on the right. */
function Fact({ label, value }: { label: string; value: string }): JSX.Element {
    return (
        <div className="mx_ContactCard_fact">
            <span className="mx_ContactCard_factLabel">{label}</span>
            <span className="mx_ContactCard_factValue">{value}</span>
        </div>
    );
}

export function ContactCard({ person, onBack, onMessage, onCall, onSeparate, nickname, onRename }: Props): JSX.Element {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(nickname ?? person.name);
    const url = person.avatarUrl ? mediaFromMxc(person.avatarUrl).getSquareThumbnailHttp(96) : null;
    const shown = nickname || person.name;
    // Only where a chat exists: a call needs somewhere to happen, and starting one is not what this is.
    const callable = !!onCall && person.rooms.length > 0;

    const save = (): void => {
        onRename?.(person, draft.trim());
        setEditing(false);
    };

    return (
        <div className="mx_ContactCard">
            <div className="mx_ContactsView_header">
                <IconButton aria-label={_t("action|back")} onClick={onBack} size="32px">
                    <BackIcon />
                </IconButton>
                {onRename && !editing && (
                    <IconButton
                        aria-label={_t("contacts|rename")}
                        onClick={() => {
                            setDraft(nickname ?? person.name);
                            setEditing(true);
                        }}
                        size="32px"
                        className="mx_ContactCard_edit"
                    >
                        <EditIcon />
                    </IconButton>
                )}
            </div>

            <div className="mx_ContactCard_head">
                <BaseAvatar name={shown} idName={person.id} url={url ?? undefined} size="96px" />
                {editing ? (
                    <Form.Root
                        className="mx_ContactCard_rename"
                        onSubmit={(event) => {
                            event.preventDefault();
                            save();
                        }}
                    >
                        <Form.Field name="nickname">
                            <Form.Label>{_t("contacts|rename")}</Form.Label>
                            <Form.TextControl
                                value={draft}
                                onChange={(event) => setDraft(event.target.value)}
                                autoFocus
                            />
                        </Form.Field>
                        <div className="mx_ContactCard_renameActions">
                            <Button kind="primary" size="md" type="submit">
                                {_t("action|save")}
                            </Button>
                            {/* Explicitly not a submit: a button inside a form is one by default, so
                                cancelling saved. */}
                            <Button kind="tertiary" size="md" type="button" onClick={() => setEditing(false)}>
                                {_t("action|cancel")}
                            </Button>
                        </div>
                    </Form.Root>
                ) : (
                    <h2 className="mx_ContactCard_name">{shown}</h2>
                )}
                {/* The name a network knows them by, once the reader has given them another. */}
                {!editing && nickname && nickname !== person.name && (
                    <span className="mx_ContactCard_alias">{person.name}</span>
                )}
            </div>

            <div className="mx_ContactCard_actions">
                <IconButton aria-label={_t("action|message")} onClick={() => onMessage(person)} size="40px">
                    <ChatIcon />
                </IconButton>
                {callable && (
                    <>
                        <IconButton
                            aria-label={_t("voip|voice_call")}
                            onClick={() => onCall?.(person, false)}
                            size="40px"
                        >
                            <VoiceCallIcon />
                        </IconButton>
                        <IconButton
                            aria-label={_t("voip|video_call")}
                            onClick={() => onCall?.(person, true)}
                            size="40px"
                        >
                            <VideoCallIcon />
                        </IconButton>
                    </>
                )}
            </div>

            {!!person.keys.length && (
                <section className="mx_ContactCard_section" aria-label={_t("contacts|identifiers")}>
                    {person.keys.map((key) => (
                        <Fact key={key} label={_t("contacts|number")} value={readKey(key)} />
                    ))}
                </section>
            )}

            {/*
             * A row per account, which is the fact a merged contact exists to carry: each is a network
             * and a way to reach them on it, so each opens that chat rather than "the" chat.
             */}
            <section className="mx_ContactCard_section" aria-label={_t("contacts|on_networks")}>
                {person.accounts.map((account) => (
                    <button
                        key={`${account.network}:${account.remoteId}`}
                        type="button"
                        className="mx_ContactCard_account"
                        onClick={() => onMessage(person, account.mxid)}
                        disabled={!account.mxid}
                    >
                        <span className="mx_ContactCard_factLabel">{account.network}</span>
                        <span className="mx_ContactCard_factValue">{account.name || readKey(account.remoteId)}</span>
                    </button>
                ))}
            </section>

            {onSeparate && (
                <div className="mx_ContactCard_foot">
                    <Button kind="secondary" destructive size="md" onClick={() => onSeparate(person)}>
                        {_t("contacts|separate")}
                    </Button>
                </div>
            )}
        </div>
    );
}
