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
import { Button, IconButton, Menu, MenuItem, MenuTitle } from "@vector-im/compound-web";
import UserProfileIcon from "@vector-im/compound-design-tokens/assets/web/icons/user-profile";
import VoiceCallIcon from "@vector-im/compound-design-tokens/assets/web/icons/voice-call";
import VideoCallIcon from "@vector-im/compound-design-tokens/assets/web/icons/video-call";
import InfoIcon from "@vector-im/compound-design-tokens/assets/web/icons/info";
import ChatIcon from "@vector-im/compound-design-tokens/assets/web/icons/chat";
import VoiceMissedIcon from "@vector-im/compound-design-tokens/assets/web/icons/voice-call-missed-solid";
import VoiceDeclinedIcon from "@vector-im/compound-design-tokens/assets/web/icons/voice-call-declined-solid";
import VoiceOutgoingIcon from "@vector-im/compound-design-tokens/assets/web/icons/voice-call-outgoing-solid";
import VideoMissedIcon from "@vector-im/compound-design-tokens/assets/web/icons/video-call-missed-solid";
import VideoDeclinedIcon from "@vector-im/compound-design-tokens/assets/web/icons/video-call-declined-solid";
import VideoOutgoingIcon from "@vector-im/compound-design-tokens/assets/web/icons/video-call-outgoing-solid";
import BackIcon from "@vector-im/compound-design-tokens/assets/web/icons/chevron-left";
import CheckIcon from "@vector-im/compound-design-tokens/assets/web/icons/check";
import OverflowIcon from "@vector-im/compound-design-tokens/assets/web/icons/overflow-horizontal";
import GroupIcon from "@vector-im/compound-design-tokens/assets/web/icons/group";
import CloseIcon from "@vector-im/compound-design-tokens/assets/web/icons/close";
import FavouriteIcon from "@vector-im/compound-design-tokens/assets/web/icons/favourite";

import { _t } from "../../../languageHandler";
import { type Call, callHistory, missedCalls, unknownCallers } from "../../../utils/contacts/calls";
import { type Favourite, favourites, isFavourite, setFavourite } from "../../../utils/contacts/favourites";
import { sectionsOf } from "../../../utils/contacts/sections";
import { fuzzyMatch } from "../../../utils/search/fuzzy";
import {
    type Person,
    chosenName,
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
import { ContactCard } from "./ContactCard";
import { NetworkLogo } from "./NetworkLogo";
import { type Presence, personPresence, presenceNetwork } from "../../../utils/contacts/presence";
import { callsWith, sharedRooms } from "../../../utils/contacts/shared";
import { PersonMenu } from "./PersonMenu";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import BaseAvatar from "../avatars/BaseAvatar";
import { mediaFromMxc } from "../../../customisations/Media";
import { DirectoryMember, startDmOnFirstMessage } from "../../../utils/direct-messages";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { type ViewRoomPayload } from "../../../dispatcher/payloads/ViewRoomPayload";
import { CallType } from "matrix-js-sdk/src/webrtc/call";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";
import { SDKContextClass } from "../../../contexts/SDKContextClass.ts";
import { type ViewUserPayload } from "../../../dispatcher/payloads/ViewUserPayload";
import Spinner from "../elements/Spinner";
import { useLongPress } from "../../../hooks/useLongPress";

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

/** How long a call lasted, in the shortest form that is still true. */
function readDuration(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
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

function PersonRow({
    client,
    person,
    presence,
    onOpen,
    menu,
    selected,
    selecting,
    onToggle,
}: {
    client: MatrixClient;
    person: Person;
    /** The most awake thing any of their networks says, or nothing when none of them says anything. */
    presence?: Presence;
    onOpen: (person: Person) => void;
    /** The person's own menu, rendered around this row so it anchors to it. */
    menu: (row: JSX.Element, person: Person) => JSX.Element;
    selected: boolean;
    /** Whether a selection is being made, in which case a press picks rather than opens. */
    selecting: boolean;
    onToggle: (person: Person) => void;
}): JSX.Element {
    /*
     * What to say under the name, and never what the logos at the end of the row already say.
     *
     * Their number when a network published one - that is the thing that made these accounts one person -
     * and otherwise what a network calls them, which is a fact the row does not have anywhere else. Naming
     * the networks here as well was the same answer twice on one line.
     */
    const handle = person.accounts.map((account) => account.name).find((name) => name && name !== person.name);
    const detail = person.keys.length ? readKey(person.keys[0]) : handle;
    /* One chat per network, so a network's logo is shown once however many chats there are on it. */
    const perNetwork = new Map(person.accounts.filter((a) => a.roomId).map((a) => [a.network, a.roomId!]));

    const row = (
        <button
            type="button"
            className="mx_Contacts_row"
            aria-pressed={selecting ? selected : undefined}
            onClick={(event) => {
                // Holding a modifier picks people out of the list without leaving it, as a file list does.
                if (selecting || event.metaKey || event.ctrlKey) onToggle(person);
                else onOpen(person);
            }}
        >
            {/*
             * The tick sits on the face rather than beside it: a control that appears in the row pushes
             * every name across the moment a selection starts, so the list moves under the reader exactly
             * as they are picking things out of it.
             */}
            <span className="mx_Contacts_faceWith">
                <Face name={person.name} avatarUrl={person.avatarUrl} />
                {/* Whether they are about on any of their networks, on the face rather than in the words. */}
                {!selecting && presence && (
                    <span
                        className="mx_Contacts_presenceDot"
                        data-presence={presence}
                        role="img"
                        aria-label={presence === "online" ? _t("contacts|about") : _t("contacts|away")}
                    />
                )}
                {selecting && (
                    <span className="mx_Contacts_tick" data-selected={selected || undefined} aria-hidden="true">
                        {selected && <CheckIcon width="14" height="14" />}
                    </span>
                )}
            </span>
            <span className="mx_Contacts_rowText">
                <span className="mx_Contacts_name">{person.name}</span>
                {detail && <span className="mx_Contacts_detail">{detail}</span>}
            </span>
            {/*
             * The networks as their own logos rather than as two-letter pills: the mark says Telegram or
             * WhatsApp at a glance, where "TG" has to be read and learned first.
             */}
            <span className="mx_Contacts_networks">
                {[...perNetwork].map(([network, roomId]) => (
                    <NetworkLogo key={network} client={client} roomId={roomId} size={18} />
                ))}
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

/**
 * What kind of call it was, which way it went, and how it ended, in one mark.
 *
 * Compound carries the whole set (`voice-call-missed-solid`, `-declined-solid`, `-outgoing-solid` and the
 * video equivalents), which is the same distinction a phone's recents list draws with its arrows - so the
 * row says "missed video call" before any of its words are read.
 */
function CallMark({ call }: { call: Call }): JSX.Element {
    /*
     * The mark is the only thing that says which way the call went, so it says it out loud as well: the
     * word beside it is gone, and a label a screen reader can read is what replaces it rather than nothing.
     * `data-mark` colours it - red for the one that needs answering, as a phone colours it.
     */
    const kind = call.outgoing ? "outgoing" : call.outcome === "missed" ? "missed" : call.outcome;
    const label = call.outgoing
        ? _t("contacts|call_outgoing")
        : kind === "missed"
          ? _t("contacts|call_missed")
          : kind === "declined"
            ? _t("contacts|call_declined")
            : _t("contacts|call_incoming");
    const props = {
        className: "mx_Contacts_callMark",
        width: "16",
        height: "16",
        "data-mark": kind,
        "aria-label": label,
        role: "img",
    } as const;
    if (call.outgoing) return call.video ? <VideoOutgoingIcon {...props} /> : <VoiceOutgoingIcon {...props} />;
    if (call.outcome === "missed") return call.video ? <VideoMissedIcon {...props} /> : <VoiceMissedIcon {...props} />;
    if (call.outcome === "declined") {
        return call.video ? <VideoDeclinedIcon {...props} /> : <VoiceDeclinedIcon {...props} />;
    }
    return call.video ? <VideoCallIcon {...props} /> : <VoiceCallIcon {...props} />;
}

/** The time of day a call happened, since which day it was is the section it sits in. */
const timeOfDay = (ts: number): string =>
    new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function CallRow({
    client,
    call,
    onOpen,
    onInfo,
    onCallBack,
    onMessage,
    menuOpen,
    onMenu,
}: {
    client: MatrixClient;
    call: Call;
    onOpen: (call: Call) => void;
    /** The caller, rather than the call: who they are, not what happened. */
    onInfo: (call: Call) => void;
    onCallBack: (call: Call, video: boolean) => void;
    onMessage: (call: Call) => void;
    menuOpen: boolean;
    onMenu: (open: boolean) => void;
}): JSX.Element {
    const missed = call.outcome === "missed" && !call.outgoing;
    /*
     * Nothing the row already shows: the network is the logo at the end, and which way the call went and
     * how it ended is the coloured mark at the start. Spelling "Missed" out beside a red missed-call arrow
     * is the same fact twice, on the line with the least room for it, so what is left is how long it ran
     * and - when it was one - that it was a group.
     */
    const detail = [
        call.seconds !== undefined ? readDuration(call.seconds) : undefined,
        call.group ? _t("contacts|call_group") : undefined,
    ]
        .filter(Boolean)
        .join(" · ");

    /*
     * A call row answers three questions, so the row itself takes only the first: it goes to the call in
     * the chat it happened in. Who rang is the info button, which is what an info button means; everything
     * that can be done about it is the menu, reachable by right-click, by long press, or by its control.
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
                <Face name={call.title} avatarUrl={call.avatarUrl} />
                <span className="mx_Contacts_rowText">
                    <span className="mx_Contacts_name">{call.title}</span>
                    <span className="mx_Contacts_detail">
                        <CallMark call={call} />
                        {detail}
                    </span>
                </span>
                <span className="mx_Contacts_when">{timeOfDay(call.ts)}</span>
                <NetworkLogo client={client} roomId={call.roomId} size={18} />
            </button>
            <IconButton
                size="24px"
                aria-label={_t("contacts|caller_info", { name: call.title })}
                onClick={() => onInfo(call)}
            >
                <InfoIcon />
            </IconButton>
            <Menu
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
                <MenuItem
                    hideChevron
                    Icon={ChatIcon}
                    label={_t("contacts|message")}
                    onSelect={() => onMessage(call)}
                />
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
}: {
    client: MatrixClient;
    suggestion: Suggestion;
    onMerge: (suggestion: Suggestion) => void;
    onDismiss: (suggestion: Suggestion) => void;
}): JSX.Element {
    /*
     * The faces of everyone it means, in one row.
     *
     * A merge is a question about which accounts, and the card used to name one of them and then list the
     * networks in a sentence - so the reader could not see what they were being asked to join, and the
     * sentence was long enough to be cut off saying it. A face and a network's logo per account says it
     * in the space of one row, which is also all the room a suggestion deserves above the list.
     */
    const accounts = suggestion.people.flatMap((one) =>
        one.accounts.map((account) => ({ person: one, account })),
    );
    return (
        <div className="mx_Contacts_suggestion">
            <span className="mx_Contacts_suggestionWho">
                {accounts.map(({ person, account }) => (
                    <span className="mx_Contacts_suggestionFace" key={`${account.network}:${account.remoteId}`}>
                        <Face name={person.name} avatarUrl={person.avatarUrl} />
                        <NetworkLogo client={client} roomId={account.roomId} size={14} />
                    </span>
                ))}
                <span className="mx_Contacts_name">
                    {_t("contacts|same_person_named", { name: suggestion.people[0].name })}
                </span>
            </span>
            <span className="mx_Contacts_suggestionActions">
                <IconButton
                    size="28px"
                    aria-label={_t("contacts|merge")}
                    tooltip={_t("contacts|merge")}
                    onClick={() => onMerge(suggestion)}
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
    );
}

/**
 * People, and the calls with them, in the room list's own column.
 *
 * Not a dialog: on a handset a floating panel over the chat list is the desktop answer to a problem a
 * phone does not have, and there is no room for both at once. This replaces the list and the back
 * control returns it, as the Contacts and Phone apps do. `onFinished` is that return.
 */
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
    const [query, setQuery] = useState("");
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
    const [menuFor, setMenuFor] = useState<string>();
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
        void allPeople(client, { ask: false }).then((found) => show(found, false));
        void allPeople(client).then((found) => show(found, true));
        return () => {
            alive = false;
        };
    }, [client, at]);

    const people = state?.people;
    const again = useCallback(() => setAt((n) => n + 1), []);

    const calls = useMemo(() => callHistory(client), [client]);
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
        return fuzzyMatch(
            narrowed.map((call) => ({ item: call, keys: [call.title, call.name, call.network] })),
            query,
        ).map((match) => match.item);
    }, [calls, onlyMissed, onlyUnknown, state, query]);

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
        (suggestion: Suggestion): void => {
            void linkAccounts(client, accountsOf(suggestion.people)).then(again);
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
            setPicked(new Set());
            setOpen(undefined);
            void linkAccounts(client, all).then(again);
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
    const shown = useMemo(
        () =>
            fuzzyMatch(
                (people ?? []).map((person) => ({
                    item: person,
                    keys: [person.name, ...person.keys, ...person.accounts.map((account) => account.network)],
                })),
                query,
            ).map((match) => match.item),
        [people, query],
    );

    /*
     * Letters only when the list is the whole list.
     *
     * A search is ranked by how well each person matches, so letters down its edge would point at an order
     * that is not there; without a query the list is alphabetical and the letters are how it is navigated.
     */
    const sections = useMemo(() => sectionsOf(shown, (person) => person.name), [shown]);

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
        (person: Person, mxid?: string): void => {
            const wanted = mxid ? person.accounts.find((one) => one.mxid === mxid) : undefined;
            const existing = wanted?.roomId ?? person.rooms[0];
            if (existing) {
                /*
                 * The chat opens beside the list, and the list stays.
                 *
                 * Closing contacts to show a chat threw away where the reader was - which letter, which
                 * selection, which search - for something the panel does not need to give up: this column
                 * holds the list, the room fills the one next to it.
                 */
                dis.dispatch<ViewRoomPayload>({
                    action: Action.ViewRoom,
                    room_id: existing,
                    metricsTrigger: undefined,
                });
                return;
            }
            const account = wanted ?? person.accounts.find((one) => one.mxid);
            if (!account?.mxid) return;
            void startDmOnFirstMessage(client, [
                new DirectoryMember({
                    user_id: account.mxid,
                    display_name: account.name,
                    avatar_url: account.avatarUrl,
                }),
            ]);
        },
        [client],
    );

    /** A favourite is somewhere to go: the chat with them, which is where calling them starts. */
    const openFavourite = useCallback(
        (favourite: Favourite): void => {
            dis.dispatch<ViewRoomPayload>({
                action: Action.ViewRoom,
                room_id: favourite.roomId,
                metricsTrigger: undefined,
            });
        },
        [],
    );

    /**
     * Place a call in the chat the reader picked.
     *
     * Viewed first, then placed: a call belongs to a room, and the room has to be the one on screen for
     * the call UI to have anywhere to live. Which network it goes over is decided by which chat this is -
     * that chat's bridge carries it - so the choice was already made in the menu.
     */
    const callPerson = useCallback(
        (_person: Person, roomId: string, video: boolean): void => {
            dis.dispatch<ViewRoomPayload>({
                action: Action.ViewRoom,
                room_id: roomId,
                metricsTrigger: undefined,
            });
            // Forced through Matrix calling, as the room header does for a bridged DM: those rooms carry
            // the bridge bot as a third member, which the handler counting members cannot tell from a group.
            void SDKContextClass.instance.legacyCallHandler.placeCall(
                roomId,
                video ? CallType.Video : CallType.Voice,
                undefined,
                true,
            );
        },
        [],
    );

    /** Somewhere to go: a room, at a particular event when one is named. */
    const openRoom = useCallback((roomId: string, eventId?: string): void => {
        dis.dispatch<ViewRoomPayload>({
            action: Action.ViewRoom,
            room_id: roomId,
            ...(eventId ? { event_id: eventId, highlighted: true } : {}),
            metricsTrigger: undefined,
        });
    }, []);

    /** Ringing back, in the chat the call was in - which is the network it was on. */
    const callBack = useCallback(
        (call: Call, video: boolean): void => {
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
        },
        [],
    );

    /** Writing instead of ringing: the same chat, without placing anything. */
    const messageCaller = useCallback((call: Call): void => {
        dis.dispatch<ViewRoomPayload>({
            action: Action.ViewRoom,
            room_id: call.roomId,
            metricsTrigger: undefined,
        });
    }, []);

    /** A call is somewhere to go: the call itself, in the chat it happened in. */
    const openCall = useCallback(
        (call: Call): void => {
            dis.dispatch<ViewRoomPayload>({
                action: Action.ViewRoom,
                room_id: call.roomId,
                event_id: call.eventId,
                highlighted: true,
                metricsTrigger: undefined,
            });
        },
        [],
    );

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
                        linked={person.accounts.some((a) => a.mxid && state?.linked.has(a.mxid))}
                        open={menuFor === person.id}
                        onOpenChange={(next) => setMenuFor(next ? person.id : undefined)}
                        onMessage={messagePerson}
                        onCall={callPerson}
                        onMerge={mergePeople}
                        onSeparate={separate}
                        onRename={rename}
                        onFavourite={favourite}
                        onOpen={setOpen}
                        onSelect={toggle}
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
            mergePeople,
            separate,
            rename,
            favourite,
            toggle,
        ],
    );

    /*
     * The card instead of the list, not over it. Same reasoning as contacts replacing the room list:
     * one column, one thing in it, and back returns the way it came.
     */
    if (open) {
        return (
            <div className="mx_Contacts mx_ContactsView">
                <ContactCard
                    person={open}
                    onBack={() => setOpen(undefined)}
                    onMessage={messagePerson}
                    nickname={chosenName(client, open)}
                    onRename={rename}
                    onCall={callPerson}
                    favourite={isFavourite(client, open.rooms)}
                    onFavourite={open.rooms.length ? (person, on) => favourite([person], on) : undefined}
                    menu={personMenu(<></>, open)}
                    presence={personPresence(client, open)}
                    presenceOn={presenceNetwork(client, open)}
                    calls={callsWith(calls, open)}
                    groups={sharedRooms(client, open)}
                    onOpenRoom={openRoom}
                />
            </div>
        );
    }

    return (
        <div className="mx_Contacts mx_ContactsView">
            <div className="mx_ContactsView_header">
                <IconButton aria-label={_t("action|back")} onClick={onFinished} size="32px">
                    <BackIcon />
                </IconButton>
                <h2 className="mx_ContactsView_title">{_t("contacts|title")}</h2>
            </div>
            {/*
             * One search, whichever list is showing.
             *
             * Searching only the people was the half of it that happened to be built first; a call list
             * that cannot be searched is the one place the reader is most likely to be looking for a name.
             */}
            <input
                className="mx_Contacts_search"
                type="search"
                value={query}
                placeholder={tab === "people" ? _t("contacts|search_people") : _t("contacts|search_calls")}
                onChange={(event) => setQuery(event.target.value)}
                autoFocus
            />

            {tab === "people" ? (
                <>
                    {/*
                     * What is picked, and what can be done to all of it at once. Merging several rows in
                     * one go is the point: saying "these four are one person" was four separate two-step
                     * picks before, and the bar also says how many are in hand, which a set of ticks does
                     * not.
                     */}
                    {picked.size > 0 && (
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
                            <IconButton
                                size="24px"
                                aria-label={_t("action|cancel")}
                                onClick={() => setPicked(new Set())}
                            >
                                <CloseIcon />
                            </IconButton>
                        </div>
                    )}
                    <div className="mx_Contacts_listWithIndex">
                        <div className="mx_Contacts_list" ref={listRef}>
                            {people === undefined && <Spinner />}
                            {/* Only while nothing is typed: a search is a question about one person. */}
                            {!query &&
                                state?.suggestions.map((suggestion) => (
                                    <SuggestionCard
                                        key={accountsOf(suggestion.people).join(",")}
                                        client={client}
                                        suggestion={suggestion}
                                        onMerge={merge}
                                        onDismiss={dismiss}
                                    />
                                ))}
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
                                <div className="mx_Contacts_section" data-section={section.letter} key={section.letter}>
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
                                            presence={personPresence(client, person)}
                                            onOpen={setOpen}
                                            menu={personMenu}
                                            selected={picked.has(person.id)}
                                            selecting={picked.size > 0}
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
                                <FavouriteCard key={favourite.roomId} favourite={favourite} onOpen={openFavourite} />
                            ))}
                        </div>
                    )}
                    <div className="mx_Contacts_filters">
                        <Button
                            kind={onlyMissed ? "primary" : "secondary"}
                            size="md"
                            aria-pressed={onlyMissed}
                            onClick={() => setOnlyMissed((only) => !only)}
                        >
                            {_t("contacts|call_missed")}
                        </Button>
                        <Button
                            kind={onlyUnknown ? "primary" : "secondary"}
                            size="md"
                            aria-pressed={onlyUnknown}
                            onClick={() => setOnlyUnknown((only) => !only)}
                        >
                            {_t("contacts|call_unknown")}
                        </Button>
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
    );
}
