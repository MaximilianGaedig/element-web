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
import { Button, IconButton } from "@vector-im/compound-web";
import UserProfileIcon from "@vector-im/compound-design-tokens/assets/web/icons/user-profile";
import VoiceCallIcon from "@vector-im/compound-design-tokens/assets/web/icons/voice-call";
import VideoCallIcon from "@vector-im/compound-design-tokens/assets/web/icons/video-call";
import InfoIcon from "@vector-im/compound-design-tokens/assets/web/icons/info";
import BackIcon from "@vector-im/compound-design-tokens/assets/web/icons/chevron-left";

import { _t } from "../../../languageHandler";
import { type Call, callHistory, missedCalls, unknownCallers } from "../../../utils/contacts/calls";
import { type Favourite, favourites } from "../../../utils/contacts/favourites";
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
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import BaseAvatar from "../avatars/BaseAvatar";
import { mediaFromMxc } from "../../../customisations/Media";
import { DirectoryMember, startDmOnFirstMessage } from "../../../utils/direct-messages";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { type ViewRoomPayload } from "../../../dispatcher/payloads/ViewRoomPayload";
import { type ViewUserPayload } from "../../../dispatcher/payloads/ViewUserPayload";
import { formatRelativeTime } from "../../../DateUtils";
import Spinner from "../elements/Spinner";

const AVATAR_SIZE = "32px";

interface Props {
    /** Which list to open on: people, or the calls with them. */
    initialTab?: "people" | "calls";
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

function PersonRow({
    person,
    onOpen,
    onSeparate,
}: {
    person: Person;
    onOpen: (person: Person) => void;
    /** Given only where the reader is the one who merged them, since that is the only merge to undo. */
    onSeparate?: (person: Person) => void;
}): JSX.Element {
    /*
     * What to say under the name: their number when a network published one - that is the thing that made
     * these accounts one person - and otherwise which networks they are on, which is the next most useful
     * fact and the reason this list exists.
     */
    const networks = [...new Set(person.accounts.map((account) => account.network))];
    const detail = person.keys.length ? readKey(person.keys[0]) : networks.join(" · ");

    const row = (
        <button type="button" className="mx_Contacts_row" onClick={() => onOpen(person)}>
            <Face name={person.name} avatarUrl={person.avatarUrl} />
            <span className="mx_Contacts_rowText">
                <span className="mx_Contacts_name">{person.name}</span>
                <span className="mx_Contacts_detail">{detail}</span>
            </span>
            <span className="mx_Contacts_networks">
                {networks.map((network) => (
                    <span key={network} className="mx_Contacts_network">
                        {network}
                    </span>
                ))}
            </span>
        </button>
    );

    /*
     * The row is a button, so the one beside it cannot be inside it: a button in a button is not
     * markup a browser will keep, and the click would have to be stopped from opening the chat anyway.
     */
    return onSeparate ? (
        <div className="mx_Contacts_rowWith">
            {row}
            <Button kind="tertiary" size="md" onClick={() => onSeparate(person)}>
                {_t("contacts|separate")}
            </Button>
        </div>
    ) : (
        row
    );
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

function CallRow({
    call,
    onOpen,
    onInfo,
}: {
    call: Call;
    onOpen: (call: Call) => void;
    /** The caller, rather than the call: who they are, not what happened. */
    onInfo: (call: Call) => void;
}): JSX.Element {
    const what = call.outgoing
        ? _t("contacts|call_outgoing")
        : call.outcome === "missed"
          ? _t("contacts|call_missed")
          : call.outcome === "declined"
            ? _t("contacts|call_declined")
            : _t("contacts|call_incoming");
    const detail = [what, call.network, call.seconds !== undefined ? readDuration(call.seconds) : undefined]
        .filter(Boolean)
        .join(" · ");

    /*
     * A call row answers two questions, so it is two controls: the row goes to the call in the chat it
     * happened in, and the one beside it goes to the person who made it. Outside the row for the same
     * reason the merge action is (see PersonRow): a button cannot hold another button.
     */
    return (
        <div className="mx_Contacts_rowWith">
            <button
                type="button"
                className={`mx_Contacts_row${call.outcome === "missed" && !call.outgoing ? " mx_Contacts_row_missed" : ""}`}
                onClick={() => onOpen(call)}
            >
                <Face name={call.name} avatarUrl={call.avatarUrl} />
                <span className="mx_Contacts_rowText">
                    <span className="mx_Contacts_name">{call.name}</span>
                    <span className="mx_Contacts_detail">{detail}</span>
                </span>
                <span className="mx_Contacts_when">{formatRelativeTime(new Date(call.ts))}</span>
                {call.video ? <VideoCallIcon aria-hidden /> : <VoiceCallIcon aria-hidden />}
            </button>
            <Button
                kind="tertiary"
                size="md"
                Icon={InfoIcon}
                iconOnly
                aria-label={_t("contacts|caller_info", { name: call.name })}
                onClick={() => onInfo(call)}
            />
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
    suggestion,
    onMerge,
    onDismiss,
}: {
    suggestion: Suggestion;
    onMerge: (suggestion: Suggestion) => void;
    onDismiss: (suggestion: Suggestion) => void;
}): JSX.Element {
    const networks = [...new Set(suggestion.people.flatMap((one) => one.accounts.map((a) => a.network)))];
    return (
        <div className="mx_Contacts_suggestion">
            <Face name={suggestion.people[0].name} avatarUrl={suggestion.people[0].avatarUrl} />
            <span className="mx_Contacts_rowText">
                <span className="mx_Contacts_name">{suggestion.people[0].name}</span>
                <span className="mx_Contacts_detail">
                    {_t("contacts|same_person", { networks: networks.join(", ") })}
                </span>
            </span>
            <Button kind="primary" size="md" onClick={() => onMerge(suggestion)}>
                {_t("contacts|merge")}
            </Button>
            <Button kind="tertiary" size="md" onClick={() => onDismiss(suggestion)}>
                {_t("contacts|not_same_person")}
            </Button>
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
export function ContactsView({ initialTab = "people", onFinished }: Props): JSX.Element {
    /*
     * The peg, not the context.
     *
     * Modal renders each dialog into its own React root (Modal.tsx) and provides SDKContext, i18n and
     * tooltips there but not MatrixClientContext - so useMatrixClientContext() reads the context's
     * default, which is `null as any`. The type says MatrixClient, so nothing warns, and the first
     * client.getVisibleRooms() throws during render. Every other dialog here uses the peg for this reason.
     */
    const client = MatrixClientPeg.safeGet();
    const [tab, setTab] = useState(initialTab);
    const [query, setQuery] = useState("");
    const [onlyMissed, setOnlyMissed] = useState(false);
    const [onlyUnknown, setOnlyUnknown] = useState(false);
    /* The person whose card is open, if one is: the list and one of its rows are one column's two depths. */
    const [open, setOpen] = useState<Person>();
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

    // Asked for once per opening: the bridges answer in their own time and the list fills in when they do.
    useEffect(() => {
        let alive = true;
        void allPeople(client).then((found) => {
            if (!alive) return;
            setState({
                people: found,
                // Only people the reader merged can be separated: anyone the networks' own identifiers
                // put together would be merged again by the next build, and offering to undo something
                // that comes straight back is worse than not offering it.
                linked: new Set(manualLinks(client).flat()),
                suggestions: sameNameSuggestions(found, dismissedSuggestions(client)),
            });
        });
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
        return narrowed;
    }, [calls, onlyMissed, onlyUnknown, state]);

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
    const jumpTo = useCallback((letter: string): void => {
        const list = listRef.current;
        const heading = list?.querySelector<HTMLElement>(`[data-letter="${letter}"]`);
        if (list && heading) {
            list.scrollTop += heading.getBoundingClientRect().top - list.getBoundingClientRect().top;
        }
    }, []);

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
                dis.dispatch<ViewRoomPayload>({
                    action: Action.ViewRoom,
                    room_id: existing,
                    metricsTrigger: undefined,
                });
                onFinished();
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
            onFinished();
        },
        [client, onFinished],
    );

    /** A favourite is somewhere to go: the chat with them, which is where calling them starts. */
    const openFavourite = useCallback(
        (favourite: Favourite): void => {
            dis.dispatch<ViewRoomPayload>({
                action: Action.ViewRoom,
                room_id: favourite.roomId,
                metricsTrigger: undefined,
            });
            onFinished();
        },
        [onFinished],
    );

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
            onFinished();
        },
        [onFinished],
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
            onFinished();
        },
        [client, onFinished],
    );

    /*
     * The card instead of the list, not over it. Same reasoning as contacts replacing the room list:
     * one column, one thing in it, and back returns the way it came.
     */
    if (open) {
        const linked = open.accounts.some((a) => a.mxid && state?.linked.has(a.mxid));
        return (
            <div className="mx_Contacts mx_ContactsView">
                <ContactCard
                    person={open}
                    onBack={() => setOpen(undefined)}
                    onMessage={messagePerson}
                    onSeparate={linked ? separate : undefined}
                    nickname={chosenName(client, open)}
                    onRename={rename}
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
            <div className="mx_Contacts_tabs" role="tablist">
                <Button
                    kind={tab === "people" ? "primary" : "tertiary"}
                    size="md"
                    role="tab"
                    aria-selected={tab === "people"}
                    Icon={UserProfileIcon}
                    onClick={() => setTab("people")}
                >
                    {_t("contacts|people")}
                </Button>
                <Button
                    kind={tab === "calls" ? "primary" : "tertiary"}
                    size="md"
                    role="tab"
                    aria-selected={tab === "calls"}
                    Icon={VoiceCallIcon}
                    onClick={() => setTab("calls")}
                >
                    {_t("contacts|calls")}
                </Button>
            </div>

            {tab === "people" ? (
                <>
                    <input
                        className="mx_Contacts_search"
                        type="search"
                        value={query}
                        placeholder={_t("contacts|search_people")}
                        onChange={(event) => setQuery(event.target.value)}
                        autoFocus
                    />
                    <div className="mx_Contacts_listWithIndex">
                        <div className="mx_Contacts_list" ref={listRef}>
                            {people === undefined && <Spinner />}
                            {/* Only while nothing is typed: a search is a question about one person. */}
                            {!query &&
                                state?.suggestions.map((suggestion) => (
                                    <SuggestionCard
                                        key={accountsOf(suggestion.people).join(",")}
                                        suggestion={suggestion}
                                        onMerge={merge}
                                        onDismiss={dismiss}
                                    />
                                ))}
                            {people !== undefined && !shown.length && (
                                <p className="mx_Contacts_empty">{_t("contacts|no_people")}</p>
                            )}
                            {(query ? [{ letter: "", items: shown }] : sections).map((section) => (
                                <React.Fragment key={section.letter}>
                                    {section.letter && (
                                        <h3 className="mx_Contacts_letter" data-letter={section.letter}>
                                            {section.letter}
                                        </h3>
                                    )}
                                    {section.items.map((person) => (
                                        <PersonRow
                                            key={person.id}
                                            person={person}
                                            onOpen={setOpen}
                                            onSeparate={
                                                person.accounts.some((a) => a.mxid && state?.linked.has(a.mxid))
                                                    ? separate
                                                    : undefined
                                            }
                                        />
                                    ))}
                                </React.Fragment>
                            ))}
                        </div>
                        {/* Nothing to jump between under one letter, so the index only appears above that. */}
                        {!query && sections.length > 1 && (
                            <nav className="mx_Contacts_index" aria-label={_t("contacts|index")}>
                                {sections.map((section) => (
                                    <button key={section.letter} type="button" onClick={() => jumpTo(section.letter)}>
                                        {section.letter}
                                    </button>
                                ))}
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
                            kind={onlyMissed ? "primary" : "tertiary"}
                            size="md"
                            aria-pressed={onlyMissed}
                            onClick={() => setOnlyMissed((only) => !only)}
                        >
                            {_t("contacts|call_missed")}
                        </Button>
                        <Button
                            kind={onlyUnknown ? "primary" : "tertiary"}
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
                                {onlyMissed || onlyUnknown ? _t("contacts|no_calls_matching") : _t("contacts|no_calls")}
                            </p>
                        )}
                        {shownCalls.map((call) => (
                            <CallRow
                                key={`${call.roomId}:${call.eventId}`}
                                call={call}
                                onOpen={openCall}
                                onInfo={openCaller}
                            />
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
