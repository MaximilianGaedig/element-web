/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * People, and the calls with them.
 *
 * Two lists the room list cannot be: one row per person rather than per conversation (so somebody who is on
 * WhatsApp and Signal is one row saying so, and somebody whose number you have but never messaged is a row at
 * all), and every call in one place rather than buried in the chat it happened in.
 *
 * Both are built from what the client already holds plus what the bridges will say (utils/contacts/), and both
 * are lists of things to open: a person opens the chat with them, a call jumps to the call in its chat.
 */

import React, { type JSX, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, ChatFilter, IconButton, Menu, MenuItem, MenuTitle } from "@vector-im/compound-web";
import UserProfileIcon from "@vector-im/compound-design-tokens/assets/web/icons/user-profile";
import VoiceCallIcon from "@vector-im/compound-design-tokens/assets/web/icons/voice-call";
import VideoCallIcon from "@vector-im/compound-design-tokens/assets/web/icons/video-call";
import ChatIcon from "@vector-im/compound-design-tokens/assets/web/icons/chat";
import BackIcon from "@vector-im/compound-design-tokens/assets/web/icons/chevron-left";
import ChevronIcon from "@vector-im/compound-design-tokens/assets/web/icons/chevron-down";
import ChevronRightIcon from "@vector-im/compound-design-tokens/assets/web/icons/chevron-right";
import CheckIcon from "@vector-im/compound-design-tokens/assets/web/icons/check";
import EditIcon from "@vector-im/compound-design-tokens/assets/web/icons/edit";
import OverflowIcon from "@vector-im/compound-design-tokens/assets/web/icons/overflow-horizontal";
import GroupIcon from "@vector-im/compound-design-tokens/assets/web/icons/group";
import ImportIcon from "@vector-im/compound-design-tokens/assets/web/icons/download";
import ListIcon from "@vector-im/compound-design-tokens/assets/web/icons/list-bulleted";
import DeleteIcon from "@vector-im/compound-design-tokens/assets/web/icons/delete";
import ExportIcon from "@vector-im/compound-design-tokens/assets/web/icons/share";
import CloseIcon from "@vector-im/compound-design-tokens/assets/web/icons/close";
import FavouriteIcon from "@vector-im/compound-design-tokens/assets/web/icons/favourite";

import { _t, _td } from "../../../languageHandler";
import {
    type Call,
    callHistory,
    callsWhen,
    indexedCallHistory,
    missedCalls,
    unknownCallers,
} from "../../../utils/contacts/calls";
import { type Favourite, favourites, isFavourite, setFavourite } from "../../../utils/contacts/favourites";
import { sectionsOf } from "../../../utils/contacts/sections";
import { fuzzyMatch } from "../../../utils/search/fuzzy";
import {
    type Person,
    accountId,
    namePerson,
    type Suggestion,
    accountsOf,
    allPeople,
    dismissSuggestion,
    dismissedSuggestions,
    linkAccounts,
    manualLinks,
    sameNameSuggestions,
    unlinkAccounts,
} from "../../../utils/contacts/people";
import { readKey } from "../../../utils/contacts/identity";
import { PersonCard } from "./PersonCard";
import { callInRoom, messagePerson as openChatWith } from "../../../utils/contacts/actions";
import { CallMark, readDuration, timeOfDay } from "./CallMark";
import { ContactFace } from "./ContactFace";
import { usePersonPresence } from "../../../utils/contacts/presence";
import { filingName } from "../../../utils/contacts/names";
import { nameOrder, setNameOrder } from "../../../utils/contacts/appearance";
import {
    type ContactCard as ContactCardFields,
    allCards,
    cardFor,
    fullName,
    saveLooseCard,
} from "../../../utils/contacts/card";
import { ContactEditor } from "./ContactEditor";
import { type Discovered, type DiscoverProblem, discoverOnMatrix, lookupQuery } from "../../../utils/contacts/discover";
import { setAddingContact, useAddingContact } from "../../../utils/contacts/adding";
import { setBarActions } from "../../../utils/roomListBarActions";
import {
    cardForExport,
    downloadVCard,
    parseVCards,
    shareVCard,
    toVCard,
    toVCards,
} from "../../../utils/contacts/vcard";
import { importCards } from "../../../utils/contacts/importCards";
import { addTag, contactTags, peopleTagged, removeTag, renameTag, setInTag } from "../../../utils/contacts/tags";
import { PersonMenu } from "./PersonMenu";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import BaseAvatar from "../avatars/BaseAvatar";
import { mediaFromMxc } from "../../../customisations/Media";
import dis from "../../../dispatcher/dispatcher";
import ContentMessages from "../../../ContentMessages";
import { Action } from "../../../dispatcher/actions";
import { type ViewRoomPayload } from "../../../dispatcher/payloads/ViewRoomPayload";
import { CallType } from "matrix-js-sdk/src/webrtc/call";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";
import { SDKContextClass } from "../../../contexts/SDKContextClass.ts";
import { type ViewUserPayload } from "../../../dispatcher/payloads/ViewUserPayload";
import Spinner from "../elements/Spinner";
import { useLongPress } from "../../../hooks/useLongPress";
import { useLeaving } from "../../../hooks/useLeaving";
import { setSearchQuery, usePanelSearch } from "../../../utils/panelSearch";
import { useSwipeBack } from "../../../hooks/useSwipeBack";
import { useSlidingIndicator } from "../../../hooks/useSlidingIndicator";

/** What went wrong with a lookup, spelled out so the string extractor sees every key. */
const DISCOVER_PROBLEMS: Record<DiscoverProblem, TranslationKey> = {
    "no-server": _td("contacts|discover_no_server"),
    "terms": _td("contacts|discover_terms"),
    "failed": _td("contacts|discover_failed"),
};

const AVATAR_SIZE = "32px";

interface Props {
    /**
     * Which list this is: the people, or the calls with them.
     *
     * Given rather than held, because the control that switches between them is the bar at the bottom of
     * the column - which also switches to the chats, so it is the one that knows.
     */
    tab: "people" | "calls";
    onFinished: () => void;
}

/** A face for a row, from whatever the network gave us. */
function Face({ name, avatarUrl }: { name: string; avatarUrl?: string }): JSX.Element {
    const url = avatarUrl ? mediaFromMxc(avatarUrl).getSquareThumbnailHttp(32) : null;
    return <BaseAvatar name={name} idName={name} url={url ?? undefined} size={AVATAR_SIZE} />;
}

/**
 * A row and its menu, with the ways of opening that menu that are not a control.
 *
 * Its own component rather than a function called while rendering the list: a component built during a
 * render is a new component every time, so React throws away what was inside it - here the open menu -
 * on every keystroke in the search field.
 */
function PersonRowMenu({
    row,
    onOpenMenu,
    children,
}: {
    row: JSX.Element;
    onOpenMenu: () => void;
    children: React.ReactNode;
}): JSX.Element {
    const held = useLongPress(onOpenMenu);
    return (
        <div
            className="mx_Contacts_rowWith"
            onContextMenu={(event) => {
                event.preventDefault();
                onOpenMenu();
            }}
            {...held}
        >
            {row}
            {children}
        </div>
    );
}

/**
 * An empty icon, for the choice that is not in force: without one compound lays the row out with no icon
 * column, so moving the tick from one choice to the other shifted both labels sideways.
 */
function NoIcon(props: React.SVGAttributes<SVGElement>): JSX.Element {
    return <svg {...props} aria-hidden />;
}

function PersonRow({
    client,
    person,
    onOpen,
    menu,
    selected,
    selecting,
    onToggle,
}: {
    client: MatrixClient;
    person: Person;
    onOpen: (person: Person) => void;
    /** The person's own menu, rendered around this row so it anchors to it. */
    menu: (row: JSX.Element, person: Person) => JSX.Element;
    selected: boolean;
    /** Whether a selection is being made, in which case a press picks rather than opens. */
    selecting: boolean;
    onToggle: (person: Person) => void;
}): JSX.Element {
    /*
     * Which networks they are on, once each.
     *
     * Once each because a person with four Telegram chats is on Telegram, not on Telegram four times - the
     * accounts are deduplicated here rather than in the list, so the same person cannot read as four
     * networks in one row and one in another.
     */
    // The most awake thing any of their networks says, read the way the room list reads it.
    const presence = usePersonPresence(client, person)?.info;
    const networks = [...new Map(person.accounts.map((account) => [account.network, account])).values()];

    const row = (
        <button
            type="button"
            className="mx_Contacts_row"
            aria-pressed={selecting ? selected : undefined}
            onClick={(event) => {
                // Holding a modifier picks people out of the list without leaving it, as a file list does.
                const onTick = (event.target as Element).closest?.(".mx_Contacts_rowTick");
                if (selecting || onTick || event.metaKey || event.ctrlKey) onToggle(person);
                else onOpen(person);
            }}
        >
            {/*
             * The tick sits on the face rather than beside it: a control that appears in the row pushes
             * every name across the moment a selection starts, so the list moves under the reader exactly
             * as they are picking things out of it.
             */}
            <span className="mx_Contacts_faceWith">
                <ContactFace
                    client={client}
                    name={person.name}
                    id={person.id}
                    avatarUrl={person.avatarUrl}
                    roomId={networks[0]?.roomId}
                    network={networks[0]?.network}
                    presence={selecting ? undefined : presence}
                    selected={selecting}
                />
                {/*
                 * Always there, so picking somebody is one press on their face rather than a trip through a
                 * menu: shown while a selection is being made, and on hover otherwise (_Contacts.pcss), the
                 * way a mail list offers its checkboxes. Not a button of its own - a button inside the row's
                 * button is not markup a browser keeps - so the row's press sees where it landed.
                 */}
                <span
                    className="mx_Contacts_tick mx_Contacts_rowTick"
                    data-selected={selected || undefined}
                    data-selecting={selecting || undefined}
                    aria-hidden="true"
                >
                    {selected && <CheckIcon width="14" height="14" />}
                </span>
            </span>
            <span className="mx_Contacts_rowText">
                <span className="mx_Contacts_name">{person.name}</span>
                {/*
                 * The networks, under the name, rather than a number.
                 *
                 * A number is already the thing the row is filed and searched by and reads as noise under
                 * every name; which networks somebody is on is the fact this list exists to carry, and it
                 * is what the reader picks between when they message or ring them.
                 */}
                {(networks.length > 1 || person.bot) && (
                    <span className="mx_Contacts_detail">
                        {[person.bot ? _t("contacts|bot") : undefined, ...networks.map((account) => account.network)]
                            .filter(Boolean)
                            .join(" · ")}
                    </span>
                )}
            </span>
        </button>
    );

    return menu(row, person);
}

/**
 * One of the reader's favourites, as a face to reach for.
 *
 * Above the calls rather than in them: a phone's call list opens on the people you reach for most, because
 * the list underneath is ordered by when a call happened, which is the wrong order for finding somebody.
 */
function FavouriteCard({
    favourite,
    onOpen,
}: {
    favourite: Favourite;
    onOpen: (favourite: Favourite) => void;
}): JSX.Element {
    return (
        <button type="button" className="mx_Contacts_favourite" onClick={() => onOpen(favourite)}>
            <Face name={favourite.name} avatarUrl={favourite.avatarUrl} />
            <span className="mx_Contacts_favouriteName">{favourite.name}</span>
        </button>
    );
}

/** All calls, the ones nobody answered, or the ones from people no address book holds. */
type CallsShown = "all" | "missed" | "unknown";

function CallFilter({ value, onChange }: { value: CallsShown; onChange: (next: CallsShown) => void }): JSX.Element {
    const { itemRef, style } = useSlidingIndicator<CallsShown>(value);
    const labels: Record<CallsShown, string> = {
        all: _t("contacts|call_all"),
        missed: _t("contacts|call_missed"),
        unknown: _t("contacts|call_unknown"),
    };
    return (
        <div className="mx_Contacts_filters" role="tablist">
            {style && <span className="mx_Contacts_filterSelection" style={style} aria-hidden />}
            {(Object.keys(labels) as CallsShown[]).map((key) => (
                <button
                    key={key}
                    type="button"
                    role="tab"
                    ref={itemRef(key)}
                    aria-selected={value === key}
                    onClick={() => onChange(key)}
                >
                    {labels[key]}
                </button>
            ))}
        </div>
    );
}

function CallRow({
    client,
    call,
    onOpen,
    onCallBack,
    onMessage,
    onInfo,
    menuOpen,
    onMenu,
}: {
    client: MatrixClient;
    call: Call;
    onOpen: (call: Call) => void;
    onCallBack: (call: Call, video: boolean) => void;
    onMessage: (call: Call) => void;
    /** The caller, rather than the call: who they are, not what happened. */
    onInfo: (call: Call) => void;
    menuOpen: boolean;
    onMenu: (open: boolean) => void;
}): JSX.Element {
    const missed = call.outcome === "missed" && !call.outgoing;
    /*
     * How long it ran, and whether it was a group. Not the direction or the outcome: the coloured mark in
     * front of this says both, and not the network either - the face carries that, as it does in the room
     * list.
     */
    const detail = [
        call.seconds !== undefined ? readDuration(call.seconds) : undefined,
        call.group ? _t("contacts|call_group") : undefined,
    ]
        .filter(Boolean)
        .join(" · ");

    /*
     * One row, one control.
     *
     * The info button sat beside the row on its own surface and did what the row did; the menu is the only
     * thing here that does anything else, so it is the only thing beside the name - and it sits where the
     * network logo used to, which is the end of the row a thumb reaches.
     */
    const held = useLongPress(useCallback(() => onMenu(true), [onMenu]));
    return (
        <div
            className="mx_Contacts_rowWith"
            onContextMenu={(event) => {
                event.preventDefault();
                onMenu(true);
            }}
            {...held}
        >
            <button
                type="button"
                className={`mx_Contacts_row${missed ? " mx_Contacts_row_missed" : ""}`}
                onClick={() => onOpen(call)}
            >
                <span className="mx_Contacts_faceWith">
                    <ContactFace
                        client={client}
                        name={call.title}
                        id={call.userId}
                        avatarUrl={call.avatarUrl}
                        roomId={call.roomId}
                    />
                </span>
                <span className="mx_Contacts_rowText">
                    <span className="mx_Contacts_name">{call.title}</span>
                    <span className="mx_Contacts_detail">
                        <CallMark call={call} />
                        {detail}
                    </span>
                </span>
                <span className="mx_Contacts_when">{timeOfDay(call.ts)}</span>
            </button>
            <Menu
                className="mx_Contacts_menu"
                title={call.title}
                showTitle={false}
                open={menuOpen}
                onOpenChange={onMenu}
                align="end"
                trigger={
                    <IconButton className="mx_Contacts_more" size="24px" aria-label={_t("common|options")}>
                        <OverflowIcon />
                    </IconButton>
                }
            >
                <MenuTitle title={call.title} />
                <MenuItem
                    hideChevron
                    Icon={VoiceCallIcon}
                    label={_t("contacts|call_back")}
                    onSelect={() => onCallBack(call, false)}
                />
                <MenuItem
                    hideChevron
                    Icon={VideoCallIcon}
                    label={_t("contacts|video_call")}
                    onSelect={() => onCallBack(call, true)}
                />
                <MenuItem hideChevron Icon={ChatIcon} label={_t("contacts|message")} onSelect={() => onMessage(call)} />
                <MenuItem
                    hideChevron
                    Icon={UserProfileIcon}
                    label={_t("contacts|caller_info", { name: call.title })}
                    onSelect={() => onInfo(call)}
                />
            </Menu>
        </div>
    );
}

/**
 * Two people the client could not prove are one, offered to the reader to decide.
 *
 * Both answers are kept, because either one is knowledge only the reader has: merging records the link,
 * and turning it down records that too, so the same pair is not offered again on every opening.
 */
function SuggestionCard({
    client,
    suggestion,
    onMerge,
    onDismiss,
    onOpen,
}: {
    client: MatrixClient;
    suggestion: Suggestion;
    /** The accounts the reader settled on, which is not always all of the ones offered. */
    onMerge: (suggestion: Suggestion, mxids: string[]) => void;
    onDismiss: (suggestion: Suggestion) => void;
    /** Looking at one of them, which leaves what is ticked exactly as it was. */
    onOpen?: (person: Person) => void;
}): JSX.Element {
    /*
     * One card per person, not per account.
     *
     * A person here is already every account the networks' own identifiers tie together - the same number
     * on a WhatsApp ghost and its phone-number twin, say - and listing those accounts one by one showed the
     * same person twice inside a question about whether two people are one. What is being decided is
     * which of these people are the same, so that is what is listed and ticked.
     */
    const people = suggestion.people;
    const [open, setOpen] = useState(false);
    const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(people.map((one) => one.id)));

    /*
     * What tells one card from another: the networks they are on, then a published number or handle, then
     * what a network calls them when it differs from the name on the row. An internal id comes last and
     * only when nothing else differs, shortened to the end, which is the part that differs.
     */
    const networksOf = (person: Person): string =>
        [...new Set(person.accounts.map((account) => account.network))].join(" · ");
    const tellApart = (person: Person): string => {
        const published = person.accounts
            .map((account) => account.details?.[0]?.value ?? (account.keys[0] ? readKey(account.keys[0]) : undefined))
            .find(Boolean);
        let apart = published ?? person.accounts.find((account) => account.name && account.name !== person.name)?.name;
        const alike = people.filter((one) => networksOf(one) === networksOf(person)).length > 1;
        if (!apart && alike) {
            const account = person.accounts[0];
            const id = account.mxid ? account.mxid.replace(/^@/, "").split(":")[0] : account.remoteId;
            apart = id.length > 18 ? `…${id.slice(-14)}` : id;
        }
        return [networksOf(person), apart].filter(Boolean).join(" · ");
    };

    const toggle = (id: string): void =>
        setChosen((was) => {
            const next = new Set(was);
            if (!next.delete(id)) next.add(id);
            return next;
        });

    return (
        <div className="mx_Contacts_suggestion">
            <div className="mx_Contacts_suggestionHead">
                {/*
                 * Named and counted, the way a phone puts it: one row per person with how many cards were
                 * found for them, and the cards themselves a disclosure away rather than spread across the
                 * list. Merging without opening it is the common case and stays one press.
                 */}
                <button
                    type="button"
                    className="mx_Contacts_suggestionWho"
                    aria-expanded={open}
                    onClick={() => setOpen((was) => !was)}
                >
                    <span className="mx_Contacts_suggestionFaces">
                        {suggestion.people.slice(0, 3).map((one) => (
                            <span className="mx_Contacts_suggestionFace" key={one.id}>
                                <ContactFace
                                    client={client}
                                    name={one.name}
                                    id={one.id}
                                    avatarUrl={one.avatarUrl}
                                    roomId={one.accounts.find((account) => account.roomId)?.roomId}
                                    network={one.accounts[0]?.network}
                                />
                            </span>
                        ))}
                    </span>
                    <span className="mx_Contacts_rowText">
                        <span className="mx_Contacts_name">{suggestion.people[0].name}</span>
                        <span className="mx_Contacts_detail">
                            {_t("contacts|cards_found", { count: people.length })}
                        </span>
                    </span>
                    <ChevronIcon className="mx_Contacts_suggestionChevron" data-open={open || undefined} aria-hidden />
                </button>
                <span className="mx_Contacts_suggestionActions">
                    <IconButton
                        size="28px"
                        aria-label={_t("contacts|merge")}
                        tooltip={_t("contacts|merge")}
                        disabled={chosen.size < 2}
                        onClick={() => onMerge(suggestion, accountsOf(people.filter((one) => chosen.has(one.id))))}
                    >
                        <CheckIcon />
                    </IconButton>
                    <IconButton
                        size="28px"
                        aria-label={_t("contacts|not_same_person")}
                        tooltip={_t("contacts|not_same_person")}
                        onClick={() => onDismiss(suggestion)}
                    >
                        <CloseIcon />
                    </IconButton>
                </span>
            </div>

            {/*
             * The cards themselves, each with what distinguishes it and a tick that keeps it in or leaves
             * it out - so one wrong card among four does not mean turning the whole suggestion down.
             */}
            {open && (
                <ul className="mx_Contacts_suggestionCards">
                    {people.map((person) => {
                        const picked = chosen.has(person.id);
                        // The chat that badges the face, or failing one, the network it is on.
                        const withChat = person.accounts.find((account) => account.roomId);
                        /*
                         * Two controls, because there are two things to do with a card here: the tick keeps
                         * it in or leaves it out of the merge, and the rest of the row opens the person so
                         * the reader can see who they are actually looking at. Opening one must not change
                         * what is ticked - that is the answer being composed.
                         */
                        return (
                            <li className="mx_Contacts_suggestionCard" key={person.id}>
                                <button
                                    type="button"
                                    className="mx_Contacts_suggestionTick"
                                    role="checkbox"
                                    aria-checked={picked}
                                    aria-label={_t("contacts|merge_include", { name: person.name })}
                                    onClick={() => toggle(person.id)}
                                >
                                    <span className="mx_Contacts_tick" data-selected={picked || undefined} aria-hidden>
                                        {picked && <CheckIcon width="14" height="14" />}
                                    </span>
                                </button>
                                <button
                                    type="button"
                                    className="mx_Contacts_suggestionOpen"
                                    onClick={() => onOpen?.(person)}
                                    disabled={!onOpen}
                                >
                                    <span className="mx_Contacts_faceWith">
                                        <ContactFace
                                            client={client}
                                            name={person.name}
                                            id={person.id}
                                            avatarUrl={person.avatarUrl}
                                            roomId={withChat?.roomId}
                                            network={(withChat ?? person.accounts[0])?.network}
                                        />
                                    </span>
                                    <span className="mx_Contacts_rowText">
                                        {/*
                                         * The name the list shows them by, not an account's own: a Signal
                                         * account without a profile name is called by its number, and that
                                         * put a number where the reader's name for them belongs. What the
                                         * account calls itself still shows, under it, when it differs.
                                         */}
                                        <span className="mx_Contacts_name">{person.name}</span>
                                        <span className="mx_Contacts_detail" title={tellApart(person)}>
                                            {tellApart(person)}
                                        </span>
                                    </span>
                                    <ChevronRightIcon width="20" height="20" aria-hidden />
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}

/**
 * People, and the calls with them, in the room list's own column.
 *
 * Not a dialog: on a handset a floating panel over the chat list is the desktop answer to a problem a
 * phone does not have, and there is no room for both at once. This replaces the list and the back
 * control returns it, as the Contacts and Phone apps do. `onFinished` is that return.
 */
const DISMISSED_DUPLICATES_KEY = "mx_contacts_duplicates_dismissed";

/** The set of duplicates whose banner the reader put away, remembered on this device. */
function useDismissedDuplicates(): [string | undefined, (key: string) => void] {
    const [dismissed, setDismissed] = useState<string | undefined>(() => {
        try {
            return localStorage.getItem(DISMISSED_DUPLICATES_KEY) ?? undefined;
        } catch {
            return undefined;
        }
    });
    const dismiss = useCallback((key: string): void => {
        setDismissed(key);
        try {
            localStorage.setItem(DISMISSED_DUPLICATES_KEY, key);
        } catch {
            // Not remembered past this session; the banner is still put away for now.
        }
    }, []);
    return [dismissed, dismiss];
}

export function ContactsView({ tab, onFinished }: Props): JSX.Element {
    /*
     * The peg, not the context.
     *
     * Modal renders each dialog into its own React root (Modal.tsx) and provides SDKContext, i18n and
     * tooltips there but not MatrixClientContext - so useMatrixClientContext() reads the context's
     * default, which is `null as any`. The type says MatrixClient, so nothing warns, and the first
     * client.getVisibleRooms() throws during render. Every other dialog here uses the peg for this reason.
     */
    const client = MatrixClientPeg.safeGet();
    /* The column is searched from the bar at its foot, which belongs to none of these views. */
    const { query } = usePanelSearch();
    const [onlyMissed, setOnlyMissed] = useState(false);
    const [onlyUnknown, setOnlyUnknown] = useState(false);
    /* The person whose card is open, if one is: the list and one of its rows are one column's two depths. */
    const [open, setOpen] = useState<Person>();
    /*
     * Who is picked, and whose menu is open.
     *
     * Merging by hand is not a convenience here, it is most of the merging that happens: accounts are
     * matched on published identifiers, and only some bridges publish any - so the reader has to be able
     * to say "these are the same person" themselves, and to say it about several at once rather than
     * repeating a two-step pick for each pair.
     */
    const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
    const selecting = picked.size > 0;
    const stopSelecting = useCallback((): void => setPicked(new Set()), []);
    const [menuFor, setMenuFor] = useState<string>();
    const [managing, setManaging] = useState(false);
    /* Which of the reader's own lists is showing, or all of them. */
    const [tagId, setTagId] = useState<string>();
    const [naming, setNaming] = useState(false);
    /* Writing somebody down who is not in any chat yet: started by the + beside the bar (see adding.ts). */
    const adding = useAddingContact();
    // Leaving the view puts the editor away: coming back to People should show People.
    useEffect(() => () => setAddingContact(false), []);
    const [reviewing, setReviewing] = useState(false);
    const [dismissedDuplicates, dismissDuplicates] = useDismissedDuplicates();
    const [newTagName, setNewTagName] = useState("");
    /* The tag being renamed, when the naming form is renaming one rather than making a new one. */
    const [renamingTag, setRenamingTag] = useState<string>();
    const stopNaming = (): void => {
        setNewTagName("");
        setRenamingTag(undefined);
        setNaming(false);
    };
    /* The file input is hidden and clicked by the menu item: a file button cannot live inside a menu. */
    const fileRef = useRef<HTMLInputElement>(null);
    /*
     * The list and the decisions behind it, read together.
     *
     * People are grouped by the links the reader made, so which accounts those are, and which pairings
     * they turned down, are part of the same answer - held apart they would be a build of the list and a
     * set of links from either side of a merge. Rebuilt whenever the reader decides something, which is
     * what `at` counts.
     */
    const [at, setAt] = useState(0);
    const [state, setState] = useState<{ people: Person[]; linked: Set<string>; suggestions: Suggestion[] }>();
    /* Which duplicates are being suggested, as one value: what a dismissal of the banner is remembered as. */
    const duplicatesKey = useMemo(
        () =>
            (state?.suggestions ?? [])
                .map((suggestion) => accountsOf(suggestion.people).join(","))
                .sort()
                .join("|"),
        [state],
    );

    /*
     * Twice: the chats the client already holds, then the same list again once the networks answer.
     *
     * The first pass costs no requests, so the list is on screen in the time it takes to walk the rooms;
     * the second brings the published identifiers that merge two accounts into one row and the bridges'
     * own address books, and replaces it. Without the first pass the panel sat empty for as long as the
     * slowest bridge took to answer, which is the whole of the wait the reader noticed.
     */
    useEffect(() => {
        let alive = true;
        /* The asked-for list is the better one, so a first pass that arrives after it is dropped. */
        let answered = false;
        const show = (found: Person[], asked: boolean): void => {
            if (!alive || (answered && !asked)) return;
            answered ||= asked;
            setState({
                people: found,
                // Only people the reader merged can be separated: anyone the networks' own identifiers
                // put together would be merged again by the next build, and offering to undo something
                // that comes straight back is worse than not offering it.
                linked: new Set(manualLinks(client).flat()),
                // Suggestions compare published identifiers, so they only mean anything once asked.
                suggestions: asked ? sameNameSuggestions(found, dismissedSuggestions(client)) : [],
            });
        };
        /*
         * Opening the view: both passes, the networks asked afresh. After a change the reader made (a merge, a
         * dismissal - `at` moved on), only the full build, from the answers already held: the quick pass has
         * no suggestions, so running it again emptied the duplicates and flashed the whole list on every merge.
         * What is on screen stays until the rebuilt list replaces it.
         */
        if (at === 0) {
            void allPeople(client, { ask: false }).then((found) => show(found, false));
            void allPeople(client, { fresh: true }).then((found) => show(found, true));
        } else {
            void allPeople(client).then((found) => show(found, true));
        }
        return () => {
            alive = false;
        };
    }, [client, at]);

    const people = state?.people;
    const again = useCallback(() => setAt((n) => n + 1), []);

    // What the loaded timelines hold, at once; then the whole history from the server's index.
    const [calls, setCalls] = useState(() => callHistory(client));
    useEffect(() => {
        let alive = true;
        setCalls(callHistory(client));
        void indexedCallHistory(client).then((indexed) => {
            if (alive && indexed) setCalls(indexed);
        });
        return () => {
            alive = false;
        };
    }, [client]);

    /*
     * A date in the search box, when there is one.
     *
     * "yesterday", "last Tuesday", "3 March" - the way people actually look for a call they half remember.
     * Read by the same detector the composer uses on messages, so the words it understands here are the
     * words it understands everywhere; asked for only while the calls are showing, and only after the
     * typing stops, because it loads its parser and is not worth a round per keystroke.
     */
    const [when, setWhen] = useState<{ date: Date; hasTime: boolean; text: string }>();
    useEffect(() => {
        if (tab !== "calls" || !query.trim()) {
            setWhen(undefined);
            return;
        }
        let alive = true;
        const timer = window.setTimeout(() => {
            void import("../../../utils/detect/entities").then(({ detectDateTimes }) =>
                detectDateTimes(query).then((found) => {
                    if (!alive) return;
                    const first = found[0];
                    setWhen(first ? { date: first.date, hasTime: first.hasTime, text: first.text } : undefined);
                }),
            );
        }, 250);
        return () => {
            alive = false;
            window.clearTimeout(timer);
        };
    }, [tab, query]);
    const favourited = useMemo(() => favourites(client), [client]);

    /*
     * Both filters narrow, in either order, because they ask different things: "who rang while I was out"
     * and "who that I do not know rang". Answering them together is the useful question a phone's filter
     * cannot ask, and costs nothing here.
     */
    const shownCalls = useMemo(() => {
        const saved = new Set(
            (state?.people ?? [])
                .filter((person) => person.saved)
                .flatMap((person) => person.accounts.map((account) => account.mxid))
                .filter((mxid): mxid is string => !!mxid),
        );
        let narrowed = calls;
        if (onlyMissed) narrowed = missedCalls(narrowed);
        if (onlyUnknown) narrowed = unknownCallers(narrowed, saved);
        /*
         * Searched like the people are, and by the same ranked pass: "who was that call from" is the same
         * question as "where is that person", and a list you can only filter by two toggles cannot answer
         * it. Ranking is by match, but the sections below are still days, so the order within a day is
         * whatever the search thought best and the days stay in order.
         */
        /*
         * A date in the query is a filter, not a word to match: "yesterday" narrows to that day, and the
         * rest of what was typed still ranks the names within it. With only a date typed, the day itself
         * is the whole answer and ranking has nothing left to do.
         */
        if (when) {
            narrowed = callsWhen(narrowed, when.date, when.hasTime);
            const rest = query.replace(when.text, "").trim();
            if (!rest) return narrowed;
            return fuzzyMatch(
                narrowed.map((call) => ({ item: call, keys: [call.title, call.name, call.network] })),
                rest,
            ).map((match) => match.item);
        }
        return fuzzyMatch(
            narrowed.map((call) => ({ item: call, keys: [call.title, call.name, call.network] })),
            query,
        ).map((match) => match.item);
    }, [calls, onlyMissed, onlyUnknown, state, query, when]);

    /*
     * The calls in day-sized groups, newest day first, each day's calls newest first.
     *
     * Today and yesterday are named rather than dated, which is how a phone writes the two days most of a
     * recents list is in; anything older is the date itself.
     */
    const callDays = useMemo(() => {
        const dayOf = (ts: number): string => {
            const when = new Date(ts);
            const midnight = new Date();
            midnight.setHours(0, 0, 0, 0);
            const days = Math.floor((midnight.getTime() - new Date(when).setHours(0, 0, 0, 0)) / 86_400_000);
            if (days <= 0) return _t("contacts|when_today");
            if (days === 1) return _t("contacts|when_yesterday");
            return when.toLocaleDateString(undefined, { day: "numeric", month: "long" });
        };
        const days: { day: string; calls: Call[] }[] = [];
        for (const call of shownCalls) {
            const day = dayOf(call.ts);
            const last = days[days.length - 1];
            if (last?.day === day) last.calls.push(call);
            else days.push({ day, calls: [call] });
        }
        return days;
    }, [shownCalls]);

    const merge = useCallback(
        (_suggestion: Suggestion, mxids: string[]): void => {
            void linkAccounts(client, mxids).then(again);
        },
        [client, again],
    );

    const dismiss = useCallback(
        (suggestion: Suggestion): void => {
            void dismissSuggestion(client, accountsOf(suggestion.people)).then(again);
        },
        [client, again],
    );

    const rename = useCallback(
        (person: Person, name: string): void => {
            void namePerson(client, person, name).then(again);
        },
        [client, again],
    );

    /** Marks or unmarks every chat with them, so one person is one answer - and several people at once. */
    const favourite = useCallback(
        (people: Person[], on: boolean): void => {
            void setFavourite(
                client,
                people.flatMap((person) => person.rooms),
                on,
            ).then(again);
        },
        [client, again],
    );

    /** Records that everyone named is one person, whether that is two rows or a whole selection. */
    const mergePeople = useCallback(
        (people: Person[]): void => {
            if (people.length < 2) return;
            const all = accountsOf(people);
            stopSelecting();
            setOpen(undefined);
            void linkAccounts(client, all).then(again);
        },
        [client, again, stopSelecting],
    );

    /*
     * Blocking somebody: every account they have, on the homeserver's own ignore list.
     *
     * The ignore list is per Matrix ID, and a person here is several of them - so blocking one account
     * would leave the same human ringing from the next network along, which is not what blocking means.
     */
    // `at` counts the reader's decisions: account data is not reactive, so it is what says to read it again.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    const ignored = useMemo(() => new Set(client.getIgnoredUsers()), [client, at]);
    const block = useCallback(
        (person: Person, blocked: boolean): void => {
            const theirs = person.accounts.map((account) => account.mxid).filter((mxid): mxid is string => !!mxid);
            const next = new Set(client.getIgnoredUsers());
            for (const mxid of theirs) {
                if (blocked) next.add(mxid);
                else next.delete(mxid);
            }
            void client.setIgnoredUsers([...next]).then(again);
        },
        [client, again],
    );

    /*
     * Sending somebody into a chat as a vCard.
     *
     * A file rather than a custom event: every client can show it, every address book on the other end
     * knows how to read it, and a contact shared into a room should not need this client at the far end.
     */
    const sendPerson = useCallback(
        (person: Person): void => {
            const text = toVCard(cardForExport(person, cardFor(client, person)));
            const file = new File([text], `${person.name}.vcf`, { type: "text/vcard" });
            const roomId = SDKContextClass.instance.roomViewStore.getRoomId();
            if (!roomId) return;
            void ContentMessages.sharedInstance().sendContentToRoom(file, roomId, undefined, client, undefined);
        },
        [client],
    );

    /* Out to another app, another phone or a file - whichever the platform can actually do. */
    const exportPerson = useCallback(
        (person: Person): void => {
            void shareVCard(`${person.name}.vcf`, toVCard(cardForExport(person, cardFor(client, person))));
        },
        [client],
    );

    /** One account out of a merged person, leaving the others as they were. */
    const unlinkOne = useCallback(
        (mxid: string): void => {
            void unlinkAccounts(client, [mxid]).then(again);
        },
        [client, again],
    );

    const separate = useCallback(
        (person: Person): void => {
            void unlinkAccounts(client, accountsOf([person])).then(again);
        },
        [client, again],
    );

    /*
     * Best match first, not alphabetical.
     *
     * A contact list is searched by name, by number and by network ("everyone on Signal"), and all
     * three go into the same ranked pass (utils/search/fuzzy.ts) so a typo or a missing accent still
     * finds the person. Without a query the list stays as it was built: by name.
     */
    // `at` counts the reader's decisions: account data is not reactive, so it is what says to read it again.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    const tags = useMemo(() => contactTags(client), [client, at]);
    /* A list the reader deleted while it was showing is not a filter any more. */
    const tag = tags.find((one) => one.id === tagId);
    /*
     * Bots in a list of their own.
     *
     * A bridge's bot and a network's bots are accounts you talk to, but they are not people: mixed in, they
     * sat among the contacts under names like "Telegram bridge bot". They are out of the list unless the
     * Bots filter is chosen, which is the only place they show.
     */
    const [showBots, setShowBots] = useState(false);
    const hasBots = useMemo(() => (people ?? []).some((person) => person.bot), [people]);
    const inScope = useMemo(() => {
        const all = people ?? [];
        if (showBots) return all.filter((person) => person.bot);
        return (tag ? peopleTagged(tag, all) : all).filter((person) => !person.bot);
    }, [tag, people, showBots]);

    const shown = useMemo(
        () =>
            fuzzyMatch(
                inScope.map((person) => {
                    /*
                     * What the reader wrote counts as much as what the networks published: a number typed
                     * into the card, the company somebody works for, the note about where you met them -
                     * those are the things people search an address book by, and a search that only knew
                     * the display name could not find any of them.
                     */
                    const card = cardFor(client, person);
                    return {
                        item: person,
                        keys: [
                            person.name,
                            /*
                             * Every name they go by, not only the one the row shows: the name a phone's
                             * address book saved them under on WhatsApp, an imported card's, and what a chat
                             * calls them. A merged person shows one of those, and searching for any of the
                             * others has to find them all the same.
                             */
                            ...person.accounts.flatMap((account) => (account.name ? [account.name] : [])),
                            ...person.keys,
                            ...person.accounts.map((account) => account.network),
                            ...(card
                                ? [
                                      fullName(card),
                                      card.nickname,
                                      card.company,
                                      card.jobTitle,
                                      card.notes,
                                      ...(card.phones ?? []).map((one) => one.value),
                                      ...(card.emails ?? []).map((one) => one.value),
                                      ...(card.addresses ?? []).map((one) =>
                                          [one.street, one.city, one.country].filter(Boolean).join(" "),
                                      ),
                                  ].filter((one): one is string => !!one)
                                : []),
                        ],
                    };
                }),
                query,
            ).map((match) => match.item),
        // `at` counts the reader's decisions: account data is not reactive, so it is what says to read it again.
        // oxlint-disable-next-line react-hooks/exhaustive-deps
        [inScope, query, client, at],
    );

    /*
     * Letters only when the list is the whole list.
     *
     * A search is ranked by how well each person matches, so letters down its edge would point at an order
     * that is not there; without a query the list is alphabetical and the letters are how it is navigated.
     */
    /*
     * Filed under the name the reader asked for.
     *
     * A card gives a first and a family name outright; for everyone else - which is most of the list, since
     * a bridged contact is one display name - the name is read into parts (utils/contacts/names.ts). Before
     * that they all filed under their display name whatever the setting said, so sorting by family name
     * looked like it did nothing at all.
     */
    /*
     * The order in force, held here and applied at once. Choosing one used to wait for the account data to
     * be written back and then rebuild the whole list - asking every bridge again - just to re-file names
     * already on screen; the choice is still stored, in the background.
     */
    const [order, setOrder] = useState(() => nameOrder(client));
    const chooseOrder = (next: "first" | "last"): void => {
        setOrder(next);
        void setNameOrder(client, next);
    };
    const filedAs = useCallback(
        (person: Person): string => filingName(person.name, order, cardFor(client, person)),
        [client, order],
    );
    const sections = useMemo(() => sectionsOf(shown, filedAs), [shown, filedAs]);

    /*
     * The index scrolls the list's own scroller, so the dialog around it does not move - and by measured
     * offset rather than scrollIntoView, which would scroll every scroller between here and the document.
     */
    const listRef = useRef<HTMLDivElement>(null);
    const [dragging, setDragging] = useState(false);
    const jumpTo = useCallback((letter: string): void => {
        const list = listRef.current;
        const section = list?.querySelector<HTMLElement>(`[data-section="${letter}"]`);
        if (list && section) {
            list.scrollTop += section.getBoundingClientRect().top - list.getBoundingClientRect().top;
        }
    }, []);

    /*
     * Which letter a point down the strip means.
     *
     * The strip's own height divided by how many letters are in it, so the whole strip is usable rather
     * than only the glyphs: a finger between two letters still means one of them. Clamped, so a drag that
     * runs past either end holds at the first or last letter instead of doing nothing.
     */
    const jumpToPoint = useCallback(
        (strip: HTMLElement, y: number): void => {
            const box = strip.getBoundingClientRect();
            const letters = sections.map((section) => section.letter);
            if (!letters.length || box.height <= 0) return;
            const at = Math.floor(((y - box.top) / box.height) * letters.length);
            jumpTo(letters[Math.min(letters.length - 1, Math.max(0, at))]);
        },
        [sections, jumpTo],
    );

    /**
     * A chat with them, on the account asked for or on whichever one can.
     *
     * Reached from the card rather than from the row: a row that jumped straight into a conversation left
     * nowhere to see who somebody is, which is most of what a contact list is for.
     */
    const messagePerson = useCallback(
        (person: Person, mxid?: string): void => openChatWith(client, person, mxid),
        [client],
    );

    /** A favourite is somewhere to go: the chat with them, which is where calling them starts. */
    const openFavourite = useCallback((favourite: Favourite): void => {
        dis.dispatch<ViewRoomPayload>({
            action: Action.ViewRoom,
            room_id: favourite.roomId,
            metricsTrigger: undefined,
        });
    }, []);

    /**
     * Place a call in the chat the reader picked.
     *
     * Viewed first, then placed: a call belongs to a room, and the room has to be the one on screen for
     * the call UI to have anywhere to live. Which network it goes over is decided by which chat this is -
     * that chat's bridge carries it - so the choice was already made in the menu.
     */
    const callPerson = useCallback(
        (_person: Person, roomId: string, video: boolean): void => callInRoom(roomId, video),
        [],
    );

    /*
     * The reader's own name and face, from their profile rather than from a chat: there is no room with
     * yourself to read it out of, and the one place it is always right is the account itself.
     */
    const me = client.getUser(client.getSafeUserId());
    const myName = me?.displayName ?? client.getSafeUserId();
    const myAvatar = me?.avatarUrl ?? undefined;

    /** Your own card is your profile, which the client already has a screen for. */
    const openMe = useCallback((): void => {
        dis.dispatch({ action: Action.ViewUserSettings });
    }, []);

    /*
     * Reading an address book in.
     *
     * A file rather than a sync: there is no CardDAV here, and the thing a reader actually has is the .vcf
     * their phone exported. Each card is matched to somebody already known by a number or an address it
     * carries - that is what the published identifiers are for - and anything that matches nobody is kept
     * as a card of its own, because a contact with no chat is still a contact.
     */
    const [imported, setImported] = useState<string>();
    const importVCards = useCallback(
        (text: string): void => {
            const cards = parseVCards(text);
            if (!cards.length) {
                setImported(_t("contacts|import_failed"));
                return;
            }
            void importCards(client, cards, people ?? []).then((count) => {
                setImported(_t("contacts|imported", { count }));
                again();
            });
        },
        [client, people, again],
    );

    /*
     * Finding out which of the reader's contacts have Matrix accounts.
     *
     * Asked for and confirmed, never automatic: this tells the identity server which numbers and addresses
     * are in the reader's address book, and how many are about to be sent is said before any are. The
     * server hashes what it can, but a lookup is still a disclosure.
     */
    const [discovering, setDiscovering] = useState<{
        asked: number;
        found?: Discovered[];
        problem?: DiscoverProblem;
    }>();
    const discover = useCallback(
        (confirmed: boolean): void => {
            const cards = Object.values(allCards(client));
            if (!confirmed) {
                setDiscovering({ asked: cards.flatMap(lookupQuery).length });
                return;
            }
            void discoverOnMatrix(client, cards).then((result) =>
                setDiscovering({ asked: result.asked, found: result.found, problem: result.problem }),
            );
        },
        [client],
    );

    const exportAll = useCallback((): void => {
        const cards = (people ?? []).map((person) => cardForExport(person, cardFor(client, person)));
        downloadVCard("contacts.vcf", toVCards(cards));
    }, [client, people]);

    /*
     * A person written down rather than found: somebody whose number the reader has and whose chat they do
     * not. Stored as a card of its own, which is where an imported vCard that matched nobody goes, so the
     * two arrive in the same place.
     */
    const addPerson = useCallback(
        (fields: ContactCardFields): void => {
            void saveLooseCard(client, fields).then(() => {
                setAddingContact(false);
                again();
            });
        },
        [client, again],
    );

    /** Ringing back, in the chat the call was in - which is the network it was on. */
    const callBack = useCallback((call: Call, video: boolean): void => {
        dis.dispatch<ViewRoomPayload>({
            action: Action.ViewRoom,
            room_id: call.roomId,
            metricsTrigger: undefined,
        });
        void SDKContextClass.instance.legacyCallHandler.placeCall(
            call.roomId,
            video ? CallType.Video : CallType.Voice,
            undefined,
            true,
        );
    }, []);

    /** Writing instead of ringing: the same chat, without placing anything. */
    const messageCaller = useCallback((call: Call): void => {
        dis.dispatch<ViewRoomPayload>({
            action: Action.ViewRoom,
            room_id: call.roomId,
            metricsTrigger: undefined,
        });
    }, []);

    /** A call is somewhere to go: the call itself, in the chat it happened in. */
    const openCall = useCallback((call: Call): void => {
        dis.dispatch<ViewRoomPayload>({
            action: Action.ViewRoom,
            room_id: call.roomId,
            event_id: call.eventId,
            highlighted: true,
            metricsTrigger: undefined,
        });
    }, []);

    /**
     * The caller behind a call: their card, which here is a member of the room the call was in.
     *
     * The room has to be viewed for the card to have somewhere to open, so both go out together - the room
     * without the call highlighted, because this is a question about the person and not about that call.
     */
    const openCaller = useCallback(
        (call: Call): void => {
            dis.dispatch<ViewRoomPayload>({
                action: Action.ViewRoom,
                room_id: call.roomId,
                metricsTrigger: undefined,
            });
            const member = client.getRoom(call.roomId)?.getMember(call.userId);
            if (member) dis.dispatch<ViewUserPayload>({ action: Action.ViewUser, member });
        },
        [client],
    );

    /*
     * Going back plays the way coming in did.
     *
     * The layer is held on screen for the length of the outgoing animation rather than being dropped the
     * moment the state clears - otherwise back has nothing to animate, because the thing that would have
     * animated is already gone.
     */
    /* Dragged off the edge as well as pressed back, which is how a handheld goes back. */
    const cardRef = useRef<HTMLDivElement>(null);
    const {
        render: cardShown,
        leaving: cardLeaving,
        leave: closeCard,
    } = useLeaving(
        !!open,
        useCallback(() => setOpen(undefined), []),
    );

    useSwipeBack(cardRef, closeCard, cardShown);

    /* The duplicates leave the way the card does: slid back out, and draggable off the edge. */
    const reviewRef = useRef<HTMLDivElement>(null);
    const {
        render: reviewShown,
        leaving: reviewLeaving,
        leave: closeReview,
    } = useLeaving(
        reviewing,
        useCallback(() => setReviewing(false), []),
    );
    useSwipeBack(reviewRef, closeReview, reviewShown);

    const toggle = useCallback((person: Person): void => {
        setPicked((was) => {
            const next = new Set(was);
            if (!next.delete(person.id)) next.add(person.id);
            return next;
        });
    }, []);

    const pickedPeople = useMemo(() => (people ?? []).filter((one) => picked.has(one.id)), [people, picked]);

    /*
     * A person's menu, wrapped around whatever names them.
     *
     * The row is a button, so its own controls cannot live inside it - a button inside a button is not
     * markup a browser keeps. The wrapper holds both, and carries the ways of opening the menu that are
     * not a control at all: a right-click anywhere on the row, and a long press for touch, so the actions
     * are reachable without the reader first having to find a control to aim at.
     */
    const personMenu = useCallback(
        (row: JSX.Element, person: Person): JSX.Element => {
            return (
                <PersonRowMenu key={person.id} row={row} onOpenMenu={() => setMenuFor(person.id)}>
                    <PersonMenu
                        client={client}
                        people={picked.size > 1 && picked.has(person.id) ? pickedPeople : [person]}
                        others={(people ?? []).filter((one) => one.id !== person.id)}
                        favourited={isFavourite(client, person.rooms)}
                        linked={person.accounts.some((a) => state?.linked.has(accountId(a)))}
                        open={menuFor === person.id}
                        onOpenChange={(next) => setMenuFor(next ? person.id : undefined)}
                        onMessage={messagePerson}
                        onCall={callPerson}
                        onMerge={mergePeople}
                        onSeparate={separate}
                        onRename={rename}
                        onFavourite={favourite}
                        onOpen={setOpen}
                        onBlock={block}
                        onExport={exportPerson}
                        onSend={sendPerson}
                        tags={tags}
                        onTag={(one, member) => void setInTag(client, one.id, person, member).then(again)}
                        blocked={person.accounts.every((a) => !a.mxid || ignored.has(a.mxid))}
                        trigger={
                            <IconButton
                                className="mx_Contacts_more"
                                size="24px"
                                aria-label={_t("common|options")}
                                data-open={menuFor === person.id || undefined}
                            >
                                <OverflowIcon />
                            </IconButton>
                        }
                    />
                </PersonRowMenu>
            );
        },
        [
            client,
            people,
            picked,
            pickedPeople,
            menuFor,
            state,
            messagePerson,
            callPerson,
            block,
            exportPerson,
            sendPerson,
            ignored,
            tags,
            again,
            mergePeople,
            separate,
            rename,
            favourite,
        ],
    );

    /*
     * The duplicates, on a screen of their own: every set found, each openable to see the cards, and one
     * control that takes all of them at once - which is what a reader who trusts the matching wants and
     * what answering them one at a time is not.
     */
    /*
     * The duplicates, as a layer rather than a screen returned in place of the list.
     *
     * A card opened from here has to sit over this without taking it away: which cards are ticked and how
     * far down the reader had scrolled are the work in progress, and both were lost the moment looking at
     * somebody replaced the screen holding them.
     */
    const suggestions = useMemo(() => state?.suggestions ?? [], [state]);

    /*
     * The screen's two answers sit in the bar's islands at the foot of the column, where search and add are
     * otherwise, rather than in a row of their own above it: the way out at the start, the thing to do at the
     * end. Cleared as the screen starts to leave, so the islands turn back while it slides out.
     */
    useEffect(() => {
        if (!reviewing || reviewLeaving || !suggestions.length) {
            setBarActions(undefined);
            return;
        }
        setBarActions({
            start: {
                label: _t("contacts|ignore_all"),
                onClick: () => {
                    for (const suggestion of suggestions) dismiss(suggestion);
                    closeReview();
                },
            },
            end: {
                label: _t("contacts|merge_all"),
                primary: true,
                onClick: () => {
                    for (const suggestion of suggestions) merge(suggestion, accountsOf(suggestion.people));
                    closeReview();
                },
            },
        });
    }, [reviewing, reviewLeaving, suggestions, dismiss, merge, closeReview]);
    useEffect(() => () => setBarActions(undefined), []);
    const duplicates = reviewShown ? (
        <div ref={reviewRef} className="mx_Contacts_layer" data-leaving={reviewLeaving || undefined}>
            <div className="mx_ContactsView_header">
                <IconButton aria-label={_t("action|back")} onClick={closeReview} size="32px">
                    <BackIcon />
                </IconButton>
                <h2 className="mx_ContactsView_title">{_t("contacts|duplicates_title")}</h2>
                <span />
            </div>
            <div className="mx_Contacts_list">
                {!suggestions.length && <p className="mx_Contacts_empty">{_t("contacts|duplicates_none")}</p>}
                {suggestions.map((suggestion) => (
                    <SuggestionCard
                        key={accountsOf(suggestion.people).join(",")}
                        client={client}
                        suggestion={suggestion}
                        onMerge={merge}
                        onDismiss={dismiss}
                        onOpen={setOpen}
                    />
                ))}
            </div>
        </div>
    ) : null;

    /*
     * The card instead of the list, not over it. Same reasoning as contacts replacing the room list:
     * one column, one thing in it, and back returns the way it came.
     */
    /*
     * The card as a layer over the list, not in place of it.
     *
     * Returning the card instead of the list unmounted the list, and a list that unmounts comes back at the
     * top: opening somebody near the bottom and pressing back put the reader at A again, every time. The
     * list stays mounted underneath and keeps its scroll; the card sits on top of it.
     */
    const card =
        cardShown && open ? (
            <div ref={cardRef} className="mx_Contacts_layer" data-leaving={cardLeaving || undefined}>
                <div className="mx_Contacts mx_ContactsView">
                    <PersonCard
                        client={client}
                        person={open}
                        onBack={closeCard}
                        onChanged={again}
                        calls={calls}
                        menu={personMenu(<></>, open)}
                        linkedIds={state?.linked}
                        onUnlinkAccount={unlinkOne}
                    />
                </div>
            </div>
        ) : null;

    return (
        <div className="mx_Contacts mx_ContactsView">
            {/*
             * What is under a layer is out of reach while the layer is up.
             *
             * The list stays mounted so it keeps its scroll, which means its controls are still in the
             * document under the card - two Back buttons, two searches, a whole list a keyboard can tab
             * into behind something covering it. `inert` is what says "this is not reachable", and the
             * wrapper uses display: contents so saying it costs the layout nothing.
             */}
            <div className="mx_Contacts_under" inert={!!card || adding || reviewing || undefined}>
                <div className="mx_ContactsView_header">
                    <IconButton aria-label={_t("action|back")} onClick={onFinished} size="32px">
                        <BackIcon />
                    </IconButton>
                    {/*
                     * No title.
                     *
                     * "People and calls" named a screen the bar at the bottom already names, and put the one
                     * control up here immediately beside the words rather than at the edge where it belongs.
                     */}
                    {/*
                     * Bringing an address book in and handing it back out, which is what keeps this list from
                     * being a dead end: the file a phone exports goes in here, and what is here goes back to a
                     * phone the same way.
                     */}
                    <Menu
                        className="mx_Contacts_menu"
                        title={_t("contacts|title")}
                        showTitle={false}
                        open={managing}
                        onOpenChange={setManaging}
                        align="end"
                        trigger={
                            <IconButton aria-label={_t("common|options")} size="32px">
                                <OverflowIcon />
                            </IconButton>
                        }
                    >
                        <MenuItem
                            hideChevron
                            Icon={ImportIcon}
                            label={_t("contacts|import_vcf")}
                            onSelect={() => fileRef.current?.click()}
                        />
                        <MenuItem
                            hideChevron
                            Icon={ExportIcon}
                            label={_t("contacts|export_all_vcf")}
                            onSelect={exportAll}
                        />
                        <MenuItem
                            hideChevron
                            Icon={ListIcon}
                            label={_t("contacts|new_tag")}
                            onSelect={() => setNaming(true)}
                        />
                        <MenuItem
                            hideChevron
                            Icon={UserProfileIcon}
                            label={_t("contacts|discover")}
                            onSelect={() => discover(false)}
                        />
                        {!!tag && (
                            <MenuItem
                                hideChevron
                                Icon={EditIcon}
                                label={_t("contacts|rename_tag")}
                                onSelect={() => {
                                    setRenamingTag(tag.id);
                                    setNewTagName(tag.name);
                                    setNaming(true);
                                }}
                            />
                        )}
                        {!!tag && (
                            <MenuItem
                                hideChevron
                                Icon={DeleteIcon}
                                kind="critical"
                                label={_t("contacts|delete_tag")}
                                onSelect={() => {
                                    void removeTag(client, tag.id).then(again);
                                    setTagId(undefined);
                                }}
                            />
                        )}
                        <MenuTitle title={_t("contacts|sort_by")} />
                        {/*
                         * A choice, marked as one: a tick on the one in force and nothing on the other. Two
                         * different icons read as two different actions rather than as one setting's two
                         * positions.
                         */}
                        <MenuItem
                            hideChevron
                            Icon={order === "first" ? CheckIcon : NoIcon}
                            label={_t("contacts|sort_first")}
                            onSelect={() => chooseOrder("first")}
                        />
                        <MenuItem
                            hideChevron
                            Icon={order === "last" ? CheckIcon : NoIcon}
                            label={_t("contacts|sort_last")}
                            onSelect={() => chooseOrder("last")}
                        />
                    </Menu>
                    <input
                        ref={fileRef}
                        className="mx_Contacts_file"
                        type="file"
                        accept=".vcf,text/vcard,text/x-vcard"
                        onChange={(event) => {
                            const file = event.target.files?.[0];
                            // Cleared either way, so choosing the same file twice in a row still reads it.
                            event.target.value = "";
                            void file?.text().then(importVCards);
                        }}
                    />
                </div>
                {/* Naming a new list, in the column rather than in a dialog over it. */}
                {naming && (
                    <form
                        className="mx_Contacts_naming"
                        onSubmit={(event) => {
                            event.preventDefault();
                            const name = newTagName.trim();
                            if (name && renamingTag) void renameTag(client, renamingTag, name).then(again);
                            else if (name) void addTag(client, name).then(again);
                            stopNaming();
                        }}
                    >
                        <input
                            autoFocus
                            value={newTagName}
                            placeholder={_t("contacts|tag_name")}
                            aria-label={_t("contacts|tag_name")}
                            onChange={(event) => setNewTagName(event.target.value)}
                        />
                        <Button kind="primary" size="md" type="submit">
                            {_t("action|save")}
                        </Button>
                        <Button kind="secondary" size="md" type="button" onClick={stopNaming}>
                            {_t("action|cancel")}
                        </Button>
                    </form>
                )}
                {/*
                 * What a lookup would disclose, before it happens - and what it found, after.
                 *
                 * The count is the point of the first state: "this sends 214 phone numbers to ident.example" is
                 * the fact the reader needs, and it is not one they can work out from a list they cannot see.
                 */}
                {discovering && (
                    <div className="mx_Contacts_discover">
                        {discovering.found ? (
                            <span>
                                {discovering.found.length
                                    ? _t("contacts|discovered", { count: discovering.found.length })
                                    : _t("contacts|discovered_none")}
                            </span>
                        ) : discovering.problem ? (
                            <span>{_t(DISCOVER_PROBLEMS[discovering.problem])}</span>
                        ) : (
                            <>
                                <span>
                                    {_t("contacts|discover_warning", {
                                        count: discovering.asked,
                                        server: client.getIdentityServerUrl() ?? "",
                                    })}
                                </span>
                                <Button kind="primary" size="md" onClick={() => discover(true)}>
                                    {_t("contacts|discover_go")}
                                </Button>
                            </>
                        )}
                        <IconButton
                            size="24px"
                            aria-label={_t("action|dismiss")}
                            onClick={() => setDiscovering(undefined)}
                        >
                            <CloseIcon />
                        </IconButton>
                    </div>
                )}
                {/* What the import did, said once and dismissable, rather than a list that silently grew. */}
                {imported && (
                    <button type="button" className="mx_Contacts_imported" onClick={() => setImported(undefined)}>
                        {imported}
                        <CloseIcon width="16" height="16" aria-hidden />
                    </button>
                )}
                {tab === "people" ? (
                    <>
                        {/*
                         * The reader's own lists, as a strip they scroll through: filing people into "family"
                         * or "the band" is theirs and is seen by nobody else, which is what makes it different
                         * from the rooms they happen to share. Only shown once there is one to choose.
                         */}
                        {(!!tags.length || hasBots) && (
                            <div className="mx_Contacts_tags" role="listbox" aria-label={_t("contacts|tags")}>
                                <ChatFilter
                                    selected={!tag && !showBots}
                                    role="option"
                                    tabIndex={0}
                                    aria-selected={!tag && !showBots}
                                    onClick={() => {
                                        setTagId(undefined);
                                        setShowBots(false);
                                    }}
                                >
                                    {_t("contacts|all_contacts")}
                                </ChatFilter>
                                {tags.map((one) => (
                                    <ChatFilter
                                        key={one.id}
                                        selected={one.id === tagId && !showBots}
                                        role="option"
                                        tabIndex={0}
                                        aria-selected={one.id === tagId && !showBots}
                                        onClick={() => {
                                            setShowBots(false);
                                            setTagId(one.id === tagId ? undefined : one.id);
                                        }}
                                    >
                                        {one.name}
                                    </ChatFilter>
                                ))}
                                {hasBots && (
                                    <ChatFilter
                                        selected={showBots}
                                        role="option"
                                        tabIndex={0}
                                        aria-selected={showBots}
                                        onClick={() => setShowBots((was) => !was)}
                                    >
                                        {_t("contacts|bots")}
                                    </ChatFilter>
                                )}
                            </div>
                        )}
                        {/*
                         * What is picked, and what can be done to all of it at once. Merging several rows in
                         * one go is the point: saying "these four are one person" was four separate two-step
                         * picks before, and the bar also says how many are in hand, which a set of ticks does
                         * not.
                         */}
                        {selecting && (
                            <div className="mx_Contacts_batch" role="toolbar" aria-label={_t("contacts|selected")}>
                                <span className="mx_Contacts_batchCount">
                                    {_t("contacts|selected_count", { count: picked.size })}
                                </span>
                                <Button
                                    kind="primary"
                                    size="md"
                                    Icon={GroupIcon}
                                    disabled={picked.size < 2}
                                    onClick={() => mergePeople(pickedPeople)}
                                >
                                    {_t("contacts|merge")}
                                </Button>
                                <IconButton
                                    size="32px"
                                    aria-label={_t("contacts|favourite")}
                                    tooltip={_t("contacts|favourite")}
                                    onClick={() => favourite(pickedPeople, true)}
                                >
                                    <FavouriteIcon />
                                </IconButton>
                                <IconButton size="24px" aria-label={_t("action|cancel")} onClick={stopSelecting}>
                                    <CloseIcon />
                                </IconButton>
                            </div>
                        )}
                        <div className="mx_Contacts_listWithIndex">
                            <div className="mx_Contacts_list" ref={listRef}>
                                {/*
                                 * The reader's own card, at the top and outside the letters.
                                 *
                                 * A phone's address book opens on you: it is the card you hand to other people
                                 * and the one you edit most, and filing it under its own initial makes you
                                 * scroll to find yourself among everyone else.
                                 */}
                                {!query && (
                                    <button type="button" className="mx_Contacts_row mx_Contacts_me" onClick={openMe}>
                                        <span className="mx_Contacts_faceWith">
                                            <Face name={myName} avatarUrl={myAvatar} />
                                        </span>
                                        <span className="mx_Contacts_rowText">
                                            <span className="mx_Contacts_name">{myName}</span>
                                            <span className="mx_Contacts_detail">{_t("contacts|my_card")}</span>
                                        </span>
                                    </button>
                                )}
                                {people === undefined && <Spinner />}
                                {/*
                                 * One line about the duplicates, not the duplicates themselves.
                                 *
                                 * A phone says "3 Duplicates Found" above the list and keeps the cards on a
                                 * screen of their own, because deciding who is who is a job you sit down to -
                                 * and a stack of unanswered questions in front of the address book makes the
                                 * address book harder to use every time you open it.
                                 */}
                                {!query && !!state?.suggestions.length && duplicatesKey !== dismissedDuplicates && (
                                    <div className="mx_Contacts_duplicates">
                                        <button
                                            type="button"
                                            className="mx_Contacts_duplicatesOpen"
                                            onClick={() => setReviewing(true)}
                                        >
                                            <span className="mx_Contacts_rowText">
                                                <span className="mx_Contacts_name">
                                                    {_t("contacts|duplicates_found", {
                                                        count: state.suggestions.length,
                                                    })}
                                                </span>
                                                <span className="mx_Contacts_detail">
                                                    {_t("contacts|duplicates_what")}
                                                </span>
                                            </span>
                                            <ChevronRightIcon width="20" height="20" aria-hidden />
                                        </button>
                                        {/*
                                         * Put away until something changes: the same suggestions stay
                                         * hidden, and a new duplicate brings the line back, since that
                                         * is news the reader has not seen.
                                         */}
                                        <IconButton
                                            size="28px"
                                            aria-label={_t("action|dismiss")}
                                            onClick={() => dismissDuplicates(duplicatesKey)}
                                        >
                                            <CloseIcon />
                                        </IconButton>
                                    </div>
                                )}
                                {people !== undefined && !shown.length && (
                                    <p className="mx_Contacts_empty">{_t("contacts|no_people")}</p>
                                )}
                                {(query ? [{ letter: "", items: shown }] : sections).map((section) => (
                                    /*
                                     * A section around each letter, not a bare heading in the list.
                                     *
                                     * The headings are sticky, and siblings sticking to the same top in one
                                     * containing block all pin at zero and overlap - so an earlier letter is
                                     * still "at the top" while a later one covers it, and measuring it to
                                     * scroll there returns no distance at all. The index could go forwards
                                     * and never back. Inside its own section a heading sticks within that
                                     * section, which also makes the next one push it out as iOS does.
                                     */
                                    <div
                                        className="mx_Contacts_section"
                                        data-section={section.letter}
                                        key={section.letter}
                                    >
                                        {section.letter && (
                                            <h3 className="mx_Contacts_letter" data-letter={section.letter}>
                                                {section.letter}
                                            </h3>
                                        )}
                                        {section.items.map((person) => (
                                            <PersonRow
                                                key={person.id}
                                                client={client}
                                                person={person}
                                                onOpen={setOpen}
                                                menu={personMenu}
                                                selected={picked.has(person.id)}
                                                selecting={selecting}
                                                onToggle={toggle}
                                            />
                                        ))}
                                    </div>
                                ))}
                            </div>
                            {/* Nothing to jump between under one letter, so the index only appears above that. */}
                            {!query && sections.length > 1 && (
                                /*
                                 * A ruler you drag, not a column of buttons.
                                 *
                                 * Which letter the finger is on is worked out from where in the strip it is
                                 * rather than from what it is over, so the list follows a drag continuously and
                                 * between the letters as well as on them - pressing each one in turn was the
                                 * only way to move before, which on a touch screen is not how this is used.
                                 * Pointer events, so a mouse, a finger and a pen all take the same path, and
                                 * the pointer is captured so a drag that wanders off the strip keeps working.
                                 */
                                <nav
                                    className="mx_Contacts_index"
                                    aria-label={_t("contacts|index")}
                                    title={_t("contacts|index_hint")}
                                    onPointerDown={(event) => {
                                        event.currentTarget.setPointerCapture(event.pointerId);
                                        setDragging(true);
                                        jumpToPoint(event.currentTarget, event.clientY);
                                    }}
                                    onPointerMove={(event) => {
                                        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                                            jumpToPoint(event.currentTarget, event.clientY);
                                        }
                                    }}
                                    onPointerUp={(event) => {
                                        event.currentTarget.releasePointerCapture(event.pointerId);
                                        setDragging(false);
                                    }}
                                    onPointerCancel={() => setDragging(false)}
                                    data-dragging={dragging || undefined}
                                >
                                    {sections.map((section) => (
                                        <span key={section.letter} aria-hidden="true">
                                            {section.letter}
                                        </span>
                                    ))}
                                    {/*
                                     * The letters themselves are not buttons - a drag is not a press - so the
                                     * keyboard gets its own way in: one control per letter, reachable and named,
                                     * off screen but not hidden from assistive technology.
                                     */}
                                    <span className="mx_Contacts_indexKeys">
                                        {sections.map((section) => (
                                            <button
                                                key={section.letter}
                                                type="button"
                                                onClick={() => jumpTo(section.letter)}
                                            >
                                                {section.letter}
                                            </button>
                                        ))}
                                    </span>
                                </nav>
                            )}
                        </div>
                    </>
                ) : (
                    <>
                        {!!favourited.length && (
                            <div className="mx_Contacts_favourites" aria-label={_t("contacts|favourites")}>
                                {favourited.map((favourite) => (
                                    <FavouriteCard
                                        key={favourite.roomId}
                                        favourite={favourite}
                                        onOpen={openFavourite}
                                    />
                                ))}
                            </div>
                        )}
                        {/*
                         * All, missed, or callers nobody saved: one control with three positions, the same
                         * shape as the bar at the foot of the column. Two filled buttons that each toggled
                         * read as two switches, and left "all calls" as the state of having pressed neither.
                         */}
                        <div className="mx_Contacts_filterBar">
                            <CallFilter
                                value={onlyMissed ? "missed" : onlyUnknown ? "unknown" : "all"}
                                onChange={(next) => {
                                    setOnlyMissed(next === "missed");
                                    setOnlyUnknown(next === "unknown");
                                }}
                            />
                            {/*
                             * What the date in the search was taken to mean, said out loud and removable: a
                             * list that silently narrowed itself to one day would read as a list that had lost
                             * most of its calls.
                             */}
                            {when && (
                                <button
                                    type="button"
                                    className="mx_Contacts_dateChip"
                                    onClick={() => setSearchQuery(query.replace(when.text, "").trim())}
                                >
                                    {when.date.toLocaleDateString(undefined, {
                                        day: "numeric",
                                        month: "long",
                                        ...(when.hasTime ? { hour: "numeric", minute: "2-digit" } : {}),
                                    })}
                                    <CloseIcon width="16" height="16" aria-hidden />
                                </button>
                            )}
                        </div>
                        <div className="mx_Contacts_list">
                            {!shownCalls.length && (
                                <p className="mx_Contacts_empty">
                                    {query || onlyMissed || onlyUnknown
                                        ? _t("contacts|no_calls_matching")
                                        : _t("contacts|no_calls")}
                                </p>
                            )}
                            {/*
                             * A day per section, as a phone's recents list is: the rows carry the time of day
                             * and the section carries the day, so "yesterday evening" is one heading and one
                             * glance rather than the same date repeated down every row.
                             */}
                            {callDays.map(({ day, calls: ofDay }) => (
                                <div className="mx_Contacts_section" data-section={day} key={day}>
                                    <h3 className="mx_Contacts_letter">{day}</h3>
                                    {ofDay.map((call) => {
                                        const id = `${call.roomId}:${call.eventId}`;
                                        return (
                                            <CallRow
                                                key={id}
                                                client={client}
                                                call={call}
                                                onOpen={openCall}
                                                onInfo={openCaller}
                                                onCallBack={callBack}
                                                onMessage={messageCaller}
                                                menuOpen={menuFor === id}
                                                onMenu={(next) => setMenuFor(next ? id : undefined)}
                                            />
                                        );
                                    })}
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>

            {duplicates}
            {card}

            {/* Somebody new: the same editor the card opens, with nothing in it yet. */}
            {adding && (
                <div className="mx_Contacts_adding">
                    <ContactEditor card={{}} onCancel={() => setAddingContact(false)} onSave={addPerson} />
                </div>
            )}
        </div>
    );
}
