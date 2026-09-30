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

import React, { type JSX, useRef, useState } from "react";
import { Button, IconButton, Form, Menu, MenuItem } from "@vector-im/compound-web";
import BackIcon from "@vector-im/compound-design-tokens/assets/web/icons/chevron-left";
import ChatIcon from "@vector-im/compound-design-tokens/assets/web/icons/chat";
import VoiceCallIcon from "@vector-im/compound-design-tokens/assets/web/icons/voice-call";
import VideoCallIcon from "@vector-im/compound-design-tokens/assets/web/icons/video-call";
import EditIcon from "@vector-im/compound-design-tokens/assets/web/icons/edit";
import FavouriteIcon from "@vector-im/compound-design-tokens/assets/web/icons/favourite";
import FavouriteSolidIcon from "@vector-im/compound-design-tokens/assets/web/icons/favourite-solid";
import ExternalIcon from "@vector-im/compound-design-tokens/assets/web/icons/link";
import EmailIcon from "@vector-im/compound-design-tokens/assets/web/icons/email";
import UnlinkIcon from "@vector-im/compound-design-tokens/assets/web/icons/close";
import VerifiedIcon from "@vector-im/compound-design-tokens/assets/web/icons/verified";
import UnverifiedIcon from "@vector-im/compound-design-tokens/assets/web/icons/error";

import { _t, _td } from "../../../languageHandler";
import { type Person } from "../../../utils/contacts/people";
import { readKey } from "../../../utils/contacts/identity";
import { accountId } from "../../../utils/contacts/people";
import { accountLink } from "../../../utils/contacts/deepLinks";
import { AVATAR_COLOURS, type AvatarColour } from "../../../utils/contacts/appearance";
import { type ContactCard as ContactCardFields } from "../../../utils/contacts/card";
import { type Revision } from "../../../utils/contacts/history";
import { type Tone } from "../../../utils/contacts/tones";
import { ContactEditor } from "./ContactEditor";
import { ContactHistory } from "./ContactHistory";
import { type PersonPresence } from "../../../utils/contacts/presence";
import { formatPresence } from "../../../utils/presence/lastSeen";
import { type Verification } from "../../../utils/contacts/verification";
import { ActivityDot } from "../avatars/ActivityDot";
import { useSettingValue } from "../../../hooks/useSettings";
import { useBiography } from "../../../utils/profile/biography";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import { LinkedText } from "@element-hq/web-shared-components";
import { type SharedRoom } from "../../../utils/contacts/shared";
import { type Call } from "../../../utils/contacts/calls";
import { CallMark, readDuration, timeOfDay } from "./CallMark";
import BaseAvatar from "../avatars/BaseAvatar";
import { mediaFromMxc } from "../../../customisations/Media";

/** Each verification state's words, spelled out so the string extractor sees every key. */
const VERIFY_LABELS: Record<Verification, TranslationKey> = {
    verified: _td("contacts|verify_verified"),
    unverified: _td("contacts|verify_unverified"),
    changed: _td("contacts|verify_changed"),
};

interface Props {
    /** The person's own menu, the same one the list rows open, shown with the card's chrome. */
    menu?: React.ReactNode;
    /** The most awake thing any of their networks says, and which network says it. */
    /** The most awake of their accounts, read the way the room list reads it. */
    presence?: PersonPresence;
    /** The last few calls with them, whichever account they were with. */
    calls?: Call[];
    /** The groups you are both in. */
    groups?: SharedRoom[];
    /** Somewhere to go from either of those. */
    onOpenRoom?: (roomId: string, eventId?: string) => void;
    /**
     * Take one account back out of this person, leaving the rest merged.
     *
     * Per account rather than per person: a contact merged from four accounts with one of them wrong was
     * only fixable by pulling all four apart and redoing the other three.
     */
    onUnlinkAccount?: (mxid: string) => void;
    /** Which of their accounts the reader merged by hand, since those are the only ones to undo. */
    linkedIds?: ReadonlySet<string>;
    /** The colour the reader gave them, and how to change it. */
    colour?: AvatarColour;
    onColour?: (colour?: AvatarColour) => void;
    /** What the reader wrote about them, and how to change it. */
    card?: ContactCardFields;
    onCard?: (card: ContactCardFields) => void;
    /** Hand this person to something else, as a vCard. */
    onExport?: () => void;
    /** Give them a picture of the reader's own choosing. */
    onPhoto?: (file: File) => void;
    /** What this card has said before now, newest first, and how to put one of them back. */
    history?: readonly Revision[];
    onRestore?: (revision: Revision) => void;
    /** Throw one version away, or the lot; both needed before the panel offers either. */
    onDeleteRevision?: (revision: Revision) => void;
    onEmptyHistory?: () => void;
    /**
     * Whether the client has checked that they are who they say they are, and how to check.
     *
     * Absent for anyone it cannot be said about - a bridge ghost is a puppet the bridge controls, and
     * verifying its keys would say something true about the bridge and nothing about the person.
     */
    verification?: Verification;
    onVerify?: () => void;
    /** What they ring with and what their messages sound like, and how to change either. */
    ringtone?: Tone;
    textTone?: Tone;
    onTone?: (which: "ring" | "text", file?: File) => void;
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

/** The day of a call, or its time when it was today: a card's list spans days, the calls tab's rows don't. */
function whenOfCall(ts: number): string {
    const date = new Date(ts);
    if (date.toDateString() === new Date().toDateString()) return timeOfDay(ts);
    return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * One call with them, drawn as the calls tab draws it - the coloured mark for which way it went and how it
 * ended, how long it ran - without their face, which the card already shows at the top.
 */
function CardCallRow({
    call,
    showNetwork,
    onOpen,
}: {
    call: Call;
    showNetwork: boolean;
    onOpen?: () => void;
}): JSX.Element {
    const missed = call.outcome === "missed" && !call.outgoing;
    const label = call.outgoing
        ? _t("contacts|call_outgoing")
        : missed
          ? _t("contacts|call_missed")
          : call.outcome === "declined"
            ? _t("contacts|call_declined")
            : _t("contacts|call_incoming");
    const detail = [
        call.seconds !== undefined ? readDuration(call.seconds) : undefined,
        call.group ? _t("contacts|call_group") : undefined,
        showNetwork ? call.network : undefined,
    ]
        .filter(Boolean)
        .join(" · ");
    return (
        <button
            type="button"
            className={`mx_Contacts_row mx_ContactCard_call${missed ? " mx_Contacts_row_missed" : ""}`}
            onClick={onOpen}
            disabled={!onOpen}
        >
            <span className="mx_Contacts_rowText">
                <span className="mx_Contacts_name">{label}</span>
                <span className="mx_Contacts_detail">
                    <CallMark call={call} />
                    {detail}
                </span>
            </span>
            <span className="mx_Contacts_when">{whenOfCall(call.ts)}</span>
        </button>
    );
}

export function ContactCard({
    menu,
    card,
    onCard,
    onExport,
    onPhoto,
    history,
    onRestore,
    onDeleteRevision,
    onEmptyHistory,
    verification,
    onVerify,
    ringtone,
    textTone,
    onTone,
    colour,
    onColour,
    onUnlinkAccount,
    linkedIds,
    presence,
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
    const [editingCard, setEditingCard] = useState(false);
    const photoRef = useRef<HTMLInputElement>(null);
    const toneRefs = { ring: useRef<HTMLInputElement>(null), text: useRef<HTMLInputElement>(null) };
    const [calling, setCalling] = useState(false);
    const [draft, setDraft] = useState(nickname ?? person.name);
    /* The reader's own picture first: they chose it, and a bridge changing its avatar must not undo that. */
    const pictured = card?.photoUrl ?? person.avatarUrl;
    const url = pictured ? mediaFromMxc(pictured).getSquareThumbnailHttp(96) : null;
    const shown = nickname || person.name;
    // Only where a chat exists: a call needs somewhere to happen, and starting one is not what this is.
    const reachable = onCall ? person.accounts.filter((account) => !!account.roomId) : [];
    const email = person.details.find((detail) => detail.kind === "email")?.value;
    // The same words the chat header says ("last seen 5 minutes ago"), plus where when they are about now.
    // Their bio, from whichever of their accounts has one: the bridges carry it over from the network.
    const bio = useBiography(
        MatrixClientPeg.get() ?? undefined,
        person.accounts.map((account) => account.mxid),
    );
    const showTwelveHour = useSettingValue("showTwelveHourTimestamps");
    const presenceText = presence?.info.online
        ? _t("contacts|about_on", { network: presence.network })
        : formatPresence(presence?.info, { showTwelveHour });

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
                {/*
                 * Edit opens the whole card, as it does on a phone - the name is one field among the
                 * numbers, the addresses and the rest. Where there is nothing to edit but the name the
                 * reader gave them, it still opens the inline rename rather than nothing.
                 */}
                {(onCard || onRename) && !editing && !editingCard && (
                    <IconButton
                        aria-label={onCard ? _t("contacts|edit_contact") : _t("contacts|rename")}
                        onClick={() => {
                            if (onCard) {
                                setEditingCard(true);
                                return;
                            }
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

            {/*
             * Choosing the colour, under the name: a contact with no picture is an initial on a disc, and
             * which disc is the fastest way to tell two people of the same name apart in a list.
             */}
            {onColour && (
                <div className="mx_ContactCard_colours" role="radiogroup" aria-label={_t("contacts|colour")}>
                    {AVATAR_COLOURS.map((one) => (
                        <button
                            key={one}
                            type="button"
                            role="radio"
                            aria-checked={colour === one}
                            aria-label={_t("contacts|colour_n", { number: one })}
                            className="mx_ContactCard_colour"
                            data-colour={one}
                            onClick={() => onColour(colour === one ? undefined : one)}
                        />
                    ))}
                </div>
            )}

            {editingCard && onCard ? (
                <div className="mx_ContactCard_scroll">
                    <ContactEditor
                        card={card ?? {}}
                        onCancel={() => setEditingCard(false)}
                        onSave={(next) => {
                            onCard(next);
                            setEditingCard(false);
                        }}
                    />
                </div>
            ) : (
                <div className="mx_ContactCard_scroll">
                    {/*
                     * Tinted by the colour the reader chose, or by nothing at all when they have not chosen one -
                     * in which case the avatar keeps the colour the client already derives from their ID.
                     */}
                    <div className="mx_ContactCard_head" data-colour={colour}>
                        {/*
                         * A picture of the reader's own choosing, in front of whatever the networks publish: theirs
                         * is the one they mean, and a bridge changing its avatar should not change it back.
                         */}
                        {onPhoto && (
                            <>
                                <button
                                    type="button"
                                    className="mx_ContactCard_photoPick"
                                    onClick={() => photoRef.current?.click()}
                                >
                                    {card?.photoUrl ? _t("contacts|change_photo") : _t("contacts|add_photo")}
                                </button>
                                <input
                                    ref={photoRef}
                                    className="mx_Contacts_file"
                                    type="file"
                                    accept="image/*"
                                    onChange={(event) => {
                                        const file = event.target.files?.[0];
                                        event.target.value = "";
                                        if (file) onPhoto(file);
                                    }}
                                />
                            </>
                        )}
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
                        {/*
                         * The one line on a card that only Matrix can write: their cross-signing identity, checked
                         * or not. A changed identity comes with the way to accept it, because that is the state
                         * that needs the reader to do something.
                         */}
                        {verification && (
                            <button
                                type="button"
                                className="mx_ContactCard_verification"
                                data-state={verification}
                                disabled={verification === "verified" || !onVerify}
                                onClick={onVerify}
                            >
                                {verification === "verified" ? (
                                    <VerifiedIcon width="16" height="16" aria-hidden />
                                ) : (
                                    <UnverifiedIcon width="16" height="16" aria-hidden />
                                )}
                                {_t(VERIFY_LABELS[verification])}
                            </button>
                        )}
                        {presenceText && (
                            <span className="mx_ContactCard_presence" data-online={presence?.info.online || undefined}>
                                <ActivityDot info={presence?.info} />
                                {presenceText}
                            </span>
                        )}
                        {bio && (
                            <LinkedText className="mx_ContactCard_bio" size="sm" dir="auto">
                                {bio}
                            </LinkedText>
                        )}
                    </div>

                    {/*
                     * The four things you do with a person, as equal tiles across the card.
                     *
                     * A row of bare icon buttons says nothing about which is which until each is read; a phone puts
                     * the mark in a filled circle with its name under it, all four the same width, so the row is
                     * scanned rather than decoded. Mail is drawn even when there is nowhere to send one, disabled,
                     * because a row that changes shape per contact cannot be learned.
                     */}
                    <div className="mx_ContactCard_actions">
                        <button type="button" className="mx_ContactCard_action" onClick={() => onMessage(person)}>
                            <span className="mx_ContactCard_actionMark">
                                <ChatIcon width="24" height="24" aria-hidden />
                            </span>
                            {_t("contacts|message")}
                        </button>
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
                                className="mx_Contacts_menu"
                                open={calling}
                                onOpenChange={setCalling}
                                title={_t("contacts|call_how")}
                                showTitle={true}
                                align="center"
                                trigger={
                                    <button type="button" className="mx_ContactCard_action">
                                        <span className="mx_ContactCard_actionMark">
                                            <VoiceCallIcon width="24" height="24" aria-hidden />
                                        </span>
                                        {_t("contacts|call")}
                                    </button>
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
                        {/*
                         * Video goes where the one chat that can carry it is; with several, the same menu asks
                         * which - so the tile is only a way in, never a guess about which network to ring on.
                         */}
                        {reachable.length > 0 && (
                            <button
                                type="button"
                                className="mx_ContactCard_action"
                                onClick={() =>
                                    reachable.length === 1
                                        ? onCall?.(person, reachable[0].roomId!, true)
                                        : setCalling(true)
                                }
                            >
                                <span className="mx_ContactCard_actionMark">
                                    <VideoCallIcon width="24" height="24" aria-hidden />
                                </span>
                                {_t("contacts|video_call")}
                            </button>
                        )}
                        {/* Nowhere to send mail unless a network published an address, so it says so by being off. */}
                        <button
                            type="button"
                            className="mx_ContactCard_action"
                            disabled={!email}
                            onClick={() => email && window.open(`mailto:${email}`)}
                        >
                            <span className="mx_ContactCard_actionMark">
                                <EmailIcon width="24" height="24" aria-hidden />
                            </span>
                            {_t("contacts|email")}
                        </button>
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
                                <div
                                    className="mx_ContactCard_accountRow"
                                    key={`${account.network}:${account.remoteId}`}
                                >
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
                                    {/* Only where the reader is the one who put it here: see onUnlinkAccount. */}
                                    {onUnlinkAccount && linkedIds?.has(accountId(account)) && (
                                        <button
                                            type="button"
                                            className="mx_ContactCard_accountUnlink"
                                            aria-label={_t("contacts|unlink_account", { network: account.network })}
                                            title={_t("contacts|unlink_account", { network: account.network })}
                                            onClick={() => onUnlinkAccount(accountId(account))}
                                        >
                                            <UnlinkIcon width="20" height="20" aria-hidden />
                                        </button>
                                    )}
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
                                <CardCallRow
                                    key={`${call.roomId}:${call.eventId}`}
                                    call={call}
                                    // Which account it was on, only when there is more than one to tell apart.
                                    showNetwork={new Set(person.accounts.map((account) => account.network)).size > 1}
                                    onOpen={onOpenRoom ? () => onOpenRoom(call.roomId, call.eventId) : undefined}
                                />
                            ))}
                        </section>
                    )}

                    {/*
                     * What they sound like: the two tones a phone's card carries.
                     *
                     * Per person rather than per chat, so somebody merged from three networks rings the same
                     * whichever one they call on - which is the whole point of their being one person here.
                     */}
                    {onTone && (
                        <section className="mx_ContactCard_section" aria-label={_t("contacts|tones")}>
                            {(["ring", "text"] as const).map((which) => {
                                const tone = which === "ring" ? ringtone : textTone;
                                return (
                                    <div className="mx_ContactCard_accountRow" key={which}>
                                        <button
                                            type="button"
                                            className="mx_ContactCard_account"
                                            onClick={() => toneRefs[which].current?.click()}
                                        >
                                            <span className="mx_ContactCard_factLabel">
                                                {which === "ring" ? _t("contacts|ringtone") : _t("contacts|text_tone")}
                                            </span>
                                            <span className="mx_ContactCard_factValue">
                                                {tone?.name ?? _t("contacts|tone_default")}
                                            </span>
                                        </button>
                                        {tone && (
                                            <button
                                                type="button"
                                                className="mx_ContactCard_accountUnlink"
                                                aria-label={_t("contacts|tone_clear")}
                                                title={_t("contacts|tone_clear")}
                                                onClick={() => onTone(which)}
                                            >
                                                <UnlinkIcon width="20" height="20" aria-hidden />
                                            </button>
                                        )}
                                        <input
                                            ref={toneRefs[which]}
                                            className="mx_Contacts_file"
                                            type="file"
                                            accept="audio/*"
                                            onChange={(event) => {
                                                const file = event.target.files?.[0];
                                                event.target.value = "";
                                                if (file) onTone(which, file);
                                            }}
                                        />
                                    </div>
                                );
                            })}
                        </section>
                    )}

                    {/*
                     * Where else you know them from. Not the chats with them - those are the accounts above - but
                     * the rooms you are both in, which is the part no single account's profile can tell you.
                     */}
                    {/*
                     * What this card used to say, as versions rather than as a log.
                     *
                     * An address book quietly overwrites itself - a mis-edit, an import landing on the wrong
                     * person, a merge bringing two cards together - and none of those announce themselves. The
                     * panel is the one a password manager gives an entry (see ContactHistory): read a version,
                     * then put it back or throw it away.
                     */}
                    {!!history?.length && onRestore && onDeleteRevision && onEmptyHistory && (
                        <section className="mx_ContactCard_section" aria-label={_t("contacts|history")}>
                            <h3 className="mx_ContactCard_sectionTitle">
                                {_t("contacts|history_versions", { count: history.length })}
                            </h3>
                            <ContactHistory
                                history={history}
                                card={card}
                                onRestore={onRestore}
                                onDelete={(revision) => onDeleteRevision(revision)}
                                onEmpty={onEmptyHistory}
                            />
                        </section>
                    )}

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
            )}
        </div>
    );
}
