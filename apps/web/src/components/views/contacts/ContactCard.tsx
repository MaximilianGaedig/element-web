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
import { Button, IconButton, Form, Menu, MenuItem } from "@vector-im/compound-web";
import BackIcon from "@vector-im/compound-design-tokens/assets/web/icons/chevron-left";
import ChatIcon from "@vector-im/compound-design-tokens/assets/web/icons/chat";
import VoiceCallIcon from "@vector-im/compound-design-tokens/assets/web/icons/voice-call";
import VideoCallIcon from "@vector-im/compound-design-tokens/assets/web/icons/video-call";
import EditIcon from "@vector-im/compound-design-tokens/assets/web/icons/edit";
import FavouriteIcon from "@vector-im/compound-design-tokens/assets/web/icons/favourite";
import FavouriteSolidIcon from "@vector-im/compound-design-tokens/assets/web/icons/favourite-solid";
import ExternalIcon from "@vector-im/compound-design-tokens/assets/web/icons/link";

import { _t } from "../../../languageHandler";
import { type Person } from "../../../utils/contacts/people";
import { readKey } from "../../../utils/contacts/identity";
import { accountLink } from "../../../utils/contacts/deepLinks";
import { type Presence } from "../../../utils/contacts/presence";
import { type SharedRoom } from "../../../utils/contacts/shared";
import { type Call } from "../../../utils/contacts/calls";
import BaseAvatar from "../avatars/BaseAvatar";
import { mediaFromMxc } from "../../../customisations/Media";

interface Props {
    /** The person's own menu, the same one the list rows open, shown with the card's chrome. */
    menu?: React.ReactNode;
    /** The most awake thing any of their networks says, and which network says it. */
    presence?: Presence;
    presenceOn?: string;
    /** The last few calls with them, whichever account they were with. */
    calls?: Call[];
    /** The groups you are both in. */
    groups?: SharedRoom[];
    /** Somewhere to go from either of those. */
    onOpenRoom?: (roomId: string, eventId?: string) => void;
    person: Person;
    /** Back to the list. */
    onBack: () => void;
    /** Open the chat with them, on the account given or on whichever one can. */
    onMessage: (person: Person, mxid?: string) => void;
    /** Place a call in one of their chats; the bridge for that chat carries it to that network. */
    onCall?: (person: Person, roomId: string, video: boolean) => void;
    /** Undo a merge the reader made; absent when there is no merge of theirs to undo. */
    /** The name the reader gave them, if they gave one, and how to change it. */
    nickname?: string;
    onRename?: (person: Person, name: string) => void;
    /**
     * Say this person and another are one.
     *
     * The only merging that works on an account whose bridges publish no identifiers, which is every
     * bridge here: nothing is detected, so the reader has to be able to say so.
     */
    /** Whether they are a favourite, and how to change it; absent when there is no chat to mark. */
    favourite?: boolean;
    onFavourite?: (person: Person, on: boolean) => void;
}

/** What to call each kind of published detail. */
const DETAIL_LABEL = {
    phone: "contacts|phone",
    email: "contacts|email",
    handle: "contacts|handle",
} as const;

/** A row of the card: what it is on the left, what it says on the right. */
function Fact({ label, value }: { label: string; value: string }): JSX.Element {
    return (
        <div className="mx_ContactCard_fact">
            <span className="mx_ContactCard_factLabel">{label}</span>
            <span className="mx_ContactCard_factValue">{value}</span>
        </div>
    );
}

export function ContactCard({
    menu,
    presence,
    presenceOn,
    calls,
    groups,
    onOpenRoom,
    person,
    onBack,
    onMessage,
    onCall,
    nickname,
    onRename,
    favourite,
    onFavourite,
}: Props): JSX.Element {
    const [editing, setEditing] = useState(false);
    const [calling, setCalling] = useState(false);
    const [draft, setDraft] = useState(nickname ?? person.name);
    const url = person.avatarUrl ? mediaFromMxc(person.avatarUrl).getSquareThumbnailHttp(96) : null;
    const shown = nickname || person.name;
    // Only where a chat exists: a call needs somewhere to happen, and starting one is not what this is.
    const reachable = onCall ? person.accounts.filter((account) => !!account.roomId) : [];

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
                {onFavourite && !editing && (
                    <IconButton
                        aria-label={favourite ? _t("contacts|unfavourite") : _t("contacts|favourite")}
                        aria-pressed={!!favourite}
                        onClick={() => onFavourite(person, !favourite)}
                        size="32px"
                        className="mx_ContactCard_favourite"
                    >
                        {favourite ? <FavouriteSolidIcon /> : <FavouriteIcon />}
                    </IconButton>
                )}
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
                {menu}
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
                            <Button kind="secondary" size="md" type="button" onClick={() => setEditing(false)}>
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
                {/*
                 * Whether they are about, and where. Nothing at all when no network has said anything,
                 * because "away" that no network reported is this card making it up.
                 */}
                {presence && (
                    <span className="mx_ContactCard_presence" data-presence={presence}>
                        <span className="mx_Contacts_presenceDot" data-presence={presence} aria-hidden />
                        {presence === "online"
                            ? presenceOn
                                ? _t("contacts|about_on", { network: presenceOn })
                                : _t("contacts|about")
                            : presence === "unavailable"
                              ? _t("contacts|away")
                              : _t("contacts|offline")}
                    </span>
                )}
            </div>

            <div className="mx_ContactCard_actions">
                <IconButton aria-label={_t("action|message")} onClick={() => onMessage(person)} size="40px">
                    <ChatIcon />
                </IconButton>
                {/*
                 * One way to call per chat that exists, rather than one call button.
                 *
                 * A person reachable on three networks can be called on any of them, and which one is the
                 * question - so the button opens into the list of them, the way iOS asks before dialling.
                 * A chat is the honest unit: no bridge declares whether it carries calls, but a call
                 * placed in a chat goes over Matrix and that chat's bridge takes it from there.
                 */}
                {reachable.length > 0 && (
                    <Menu
                        open={calling}
                        onOpenChange={setCalling}
                        title={_t("contacts|call_how")}
                        showTitle={true}
                        align="center"
                        trigger={
                            <IconButton aria-label={_t("voip|voice_call")} size="40px">
                                <VoiceCallIcon />
                            </IconButton>
                        }
                    >
                        {reachable.map((account) => (
                            <React.Fragment key={account.roomId}>
                                <MenuItem
                                    Icon={VoiceCallIcon}
                                    label={_t("contacts|call_voice_on", { network: account.network })}
                                    onSelect={() => onCall?.(person, account.roomId!, false)}
                                />
                                <MenuItem
                                    Icon={VideoCallIcon}
                                    label={_t("contacts|call_video_on", { network: account.network })}
                                    onSelect={() => onCall?.(person, account.roomId!, true)}
                                />
                            </React.Fragment>
                        ))}
                    </Menu>
                )}
            </div>

            {/*
             * Everything the networks published, grouped by what it is.
             *
             * `details` rather than `keys`: keys are matching only and drop a username, which is unique to
             * one network and useless for tying accounts together but is still a fact about the person -
             * and dropping it is most of why this card had so little on it.
             */}
            {!!person.details.length && (
                <section className="mx_ContactCard_section" aria-label={_t("contacts|details")}>
                    {person.details.map((detail) => (
                        <Fact
                            key={`${detail.kind}:${detail.value}`}
                            label={_t(DETAIL_LABEL[detail.kind])}
                            value={detail.value}
                        />
                    ))}
                </section>
            )}

            {/*
             * A row per account, which is the fact a merged contact exists to carry: each is a network
             * and a way to reach them on it, so each opens that chat rather than "the" chat.
             */}
            <section className="mx_ContactCard_section" aria-label={_t("contacts|on_networks")}>
                {person.accounts.map((account) => {
                    /*
                     * Where this account is on the network itself, when the network publishes such a link.
                     * Beside the row rather than in it: pressing the row opens the bridged chat, which is
                     * what the reader wants nearly always, and the network's own app is the way out for
                     * everything a bridge cannot carry.
                     */
                    const link = accountLink(account.network, account.remoteId, account.identifiers);
                    return (
                        <div className="mx_ContactCard_accountRow" key={`${account.network}:${account.remoteId}`}>
                            <button
                                type="button"
                                className="mx_ContactCard_account"
                                onClick={() => onMessage(person, account.mxid)}
                                disabled={!account.mxid}
                            >
                                <span className="mx_ContactCard_factLabel">{account.network}</span>
                                <span className="mx_ContactCard_factValue">
                                    {account.name || readKey(account.remoteId)}
                                </span>
                                {/* What the network shows to tell people of the same name apart. */}
                                {account.context && (
                                    <span className="mx_ContactCard_factNote">{account.context}</span>
                                )}
                            </button>
                            {link && (
                                <a
                                    className="mx_ContactCard_accountLink"
                                    href={link.url}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    aria-label={_t("contacts|open_on", { network: account.network })}
                                    title={_t("contacts|open_on", { network: account.network })}
                                >
                                    <ExternalIcon width="20" height="20" />
                                </a>
                            )}
                        </div>
                    );
                })}
            </section>

            {/*
             * The calls with them, whichever account each was on: the calls list answers "who rang" and
             * this answers "when did we last speak", which is the same history asked from the other end.
             */}
            {!!calls?.length && (
                <section className="mx_ContactCard_section" aria-label={_t("contacts|calls")}>
                    {calls.map((call) => (
                        <button
                            key={`${call.roomId}:${call.eventId}`}
                            type="button"
                            className="mx_ContactCard_account"
                            onClick={() => onOpenRoom?.(call.roomId, call.eventId)}
                            disabled={!onOpenRoom}
                        >
                            <span className="mx_ContactCard_factLabel">
                                {call.outgoing
                                    ? _t("contacts|call_outgoing")
                                    : call.outcome === "missed"
                                      ? _t("contacts|call_missed")
                                      : call.outcome === "declined"
                                        ? _t("contacts|call_declined")
                                        : _t("contacts|call_incoming")}
                            </span>
                            <span className="mx_ContactCard_factValue">
                                {new Date(call.ts).toLocaleString(undefined, {
                                    day: "numeric",
                                    month: "short",
                                    hour: "numeric",
                                    minute: "2-digit",
                                })}
                            </span>
                        </button>
                    ))}
                </section>
            )}

            {/*
             * Where else you know them from. Not the chats with them - those are the accounts above - but
             * the rooms you are both in, which is the part no single account's profile can tell you.
             */}
            {!!groups?.length && (
                <section className="mx_ContactCard_section" aria-label={_t("contacts|groups")}>
                    {groups.map((group) => (
                        <button
                            key={group.roomId}
                            type="button"
                            className="mx_ContactCard_account"
                            onClick={() => onOpenRoom?.(group.roomId)}
                            disabled={!onOpenRoom}
                        >
                            <span className="mx_ContactCard_factValue">{group.name}</span>
                            <span className="mx_ContactCard_factNote">
                                {_t("contacts|group_members", { count: group.members })}
                            </span>
                        </button>
                    ))}
                </section>
            )}
        </div>
    );
}
