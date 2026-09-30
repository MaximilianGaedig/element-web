/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, type ReactNode, useMemo, useState } from "react";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";
import { Form, Menu, MenuItem, MenuTitle } from "@vector-im/compound-web";
import ChatIcon from "@vector-im/compound-design-tokens/assets/web/icons/chat";
import VoiceCallIcon from "@vector-im/compound-design-tokens/assets/web/icons/voice-call";
import VideoCallIcon from "@vector-im/compound-design-tokens/assets/web/icons/video-call";
import GroupIcon from "@vector-im/compound-design-tokens/assets/web/icons/group";
import EditIcon from "@vector-im/compound-design-tokens/assets/web/icons/edit";
import FavouriteIcon from "@vector-im/compound-design-tokens/assets/web/icons/favourite";
import FavouriteSolidIcon from "@vector-im/compound-design-tokens/assets/web/icons/favourite-solid";
import LinkIcon from "@vector-im/compound-design-tokens/assets/web/icons/link";
import ExternalIcon from "@vector-im/compound-design-tokens/assets/web/icons/extensions";
import CheckIcon from "@vector-im/compound-design-tokens/assets/web/icons/check";
import BlockIcon from "@vector-im/compound-design-tokens/assets/web/icons/block";
import ShareIcon from "@vector-im/compound-design-tokens/assets/web/icons/share";
import ListIcon from "@vector-im/compound-design-tokens/assets/web/icons/list-bulleted";
import UserProfileIcon from "@vector-im/compound-design-tokens/assets/web/icons/user-profile";
import BackIcon from "@vector-im/compound-design-tokens/assets/web/icons/chevron-left";

import { _t } from "../../../languageHandler";
import { type Person } from "../../../utils/contacts/people";
import { fuzzyMatch } from "../../../utils/search/fuzzy";
import { type AccountLink, accountLink } from "../../../utils/contacts/deepLinks";
import { type ContactList, inList } from "../../../utils/contacts/lists";
import { NetworkLogo } from "./NetworkLogo";

/**
 * What the menu is showing.
 *
 * One menu that changes what is in it, rather than a screen per task: picking which network to call over,
 * choosing who somebody is the same person as, and giving them a name are all one or two taps from the
 * row they are about, and none of them takes the list away to come back to.
 */
type View = "root" | "voice" | "video" | "merge" | "rename" | "lists";

export interface PersonActions {
    /** Open the chat with them, on a particular account if one is named. */
    onMessage: (person: Person, mxid?: string) => void;
    /** Place a call in one of their chats; which chat decides which network carries it. */
    onCall: (person: Person, roomId: string, video: boolean) => void;
    /** Record that these are all one person. */
    onMerge: (people: Person[]) => void;
    /** Undo a merge the reader made. */
    onSeparate: (person: Person) => void;
    onRename: (person: Person, name: string) => void;
    onFavourite: (people: Person[], on: boolean) => void;
    /** Show the whole card for them. */
    onOpen: (person: Person) => void;
    /** Stop hearing from them at all: every account they have goes on the ignore list. */
    onBlock?: (person: Person, blocked: boolean) => void;
    /** Hand them to something else as a vCard. */
    onExport?: (person: Person) => void;
    /** Start picking several, with this one picked. */
    onSelect?: (person: Person) => void;
}

interface Props extends PersonActions {
    client: MatrixClient;
    /** One person, or everyone currently picked - the same menu serves both. */
    people: Person[];
    /** Everyone this person could be merged with: the rest of the list. */
    others: Person[];
    favourited: boolean;
    /** Whether a merge the reader made is what put this person together. */
    linked: boolean;
    /** Whether every account of theirs is already ignored. */
    blocked?: boolean;
    /** The reader's own lists, and whether this person is in each. */
    lists?: readonly ContactList[];
    onList?: (list: ContactList, member: boolean) => void;
    trigger: ReactNode;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

/** A row in the menu that names a chat, with the logo of the network carrying it. */
function ChatItem({
    client,
    roomId,
    label,
    Icon,
    onSelect,
}: {
    client: MatrixClient;
    roomId?: string;
    label: string;
    Icon: React.ComponentType<React.SVGAttributes<SVGElement>>;
    onSelect: () => void;
}): JSX.Element {
    return (
        <MenuItem hideChevron Icon={Icon} label={label} onSelect={onSelect}>
            <NetworkLogo client={client} roomId={roomId} size={20} />
        </MenuItem>
    );
}

/**
 * Everything that can be done to a person, wherever they are named.
 *
 * The same menu opens from a row, from the card and from a selection, so an action is never somewhere the
 * reader has to go and find: a right-click, a long press or the row's own control all reach all of it.
 */
export function PersonMenu({
    client,
    people,
    others,
    favourited,
    linked,
    trigger,
    open,
    onOpenChange,
    onMessage,
    onCall,
    onMerge,
    onSeparate,
    onRename,
    onFavourite,
    onOpen,
    onSelect,
    onBlock,
    onExport,
    blocked,
    lists,
    onList,
}: Props): JSX.Element {
    const [view, setView] = useState<View>("root");
    const [query, setQuery] = useState("");
    const [name, setName] = useState("");
    const batch = people.length > 1;
    const person = people[0];

    // Back to the first view whenever the menu closes, so it never reopens halfway through something.
    const change = (next: boolean): void => {
        if (!next) {
            setView("root");
            setQuery("");
        }
        onOpenChange(next);
    };

    const act = (run: () => void): void => {
        run();
        change(false);
    };

    /*
     * An item that only changes which view the menu is showing.
     *
     * Radix dismisses the menu when an item is chosen unless the handler prevents it, so without this the
     * menu closed on the way into its own sub-view and the reader was left back at the list.
     */
    const keepOpen =
        (run: () => void) =>
        (event: Event): void => {
            event.preventDefault();
            run();
        };

    /* Their chats, which are what a call or a message can be sent over. */
    const chats = useMemo(() => (batch ? [] : person.accounts.filter((account) => account.roomId)), [batch, person]);

    /* Each account's way out to its own network, where the network publishes one. */
    const links = useMemo(
        () =>
            batch
                ? []
                : person.accounts
                      .map((account) => ({
                          account,
                          link: accountLink(account.network, account.remoteId, account.identifiers),
                      }))
                      .filter(
                          (both): both is { account: (typeof person.accounts)[number]; link: AccountLink } =>
                              !!both.link,
                      ),
        [batch, person],
    );

    const candidates = useMemo(
        () =>
            fuzzyMatch(
                others.map((one) => ({ item: one, keys: [one.name, ...one.keys] })),
                query,
            )
                .map((match) => match.item)
                .slice(0, 8),
        [others, query],
    );

    const title = batch ? _t("contacts|selected_count", { count: people.length }) : person.name;

    return (
        <Menu title={title} showTitle={false} open={open} onOpenChange={change} trigger={trigger} align="end">
            {view === "root" && (
                <>
                    <MenuTitle title={title} />
                    {!batch && (
                        <MenuItem
                            hideChevron
                            Icon={UserProfileIcon}
                            label={_t("contacts|open_card")}
                            onSelect={() => act(() => onOpen(person))}
                        />
                    )}
                    {!batch && !!chats.length && (
                        <MenuItem
                            hideChevron
                            Icon={ChatIcon}
                            label={_t("contacts|message")}
                            onSelect={() => act(() => onMessage(person))}
                        />
                    )}
                    {/*
                     * One chat needs no choosing; several do, and which one is picked is which network the
                     * call goes over, so the choice is the network - shown with each network's own logo.
                     */}
                    {!batch && chats.length === 1 && (
                        <>
                            <MenuItem
                                hideChevron
                                Icon={VoiceCallIcon}
                                label={_t("contacts|call")}
                                onSelect={() => act(() => onCall(person, chats[0].roomId!, false))}
                            />
                            <MenuItem
                                hideChevron
                                Icon={VideoCallIcon}
                                label={_t("contacts|video_call")}
                                onSelect={() => act(() => onCall(person, chats[0].roomId!, true))}
                            />
                        </>
                    )}
                    {!batch && chats.length > 1 && (
                        <>
                            <MenuItem
                                Icon={VoiceCallIcon}
                                label={_t("contacts|call")}
                                onSelect={keepOpen(() => setView("voice"))}
                            />
                            <MenuItem
                                Icon={VideoCallIcon}
                                label={_t("contacts|video_call")}
                                onSelect={keepOpen(() => setView("video"))}
                            />
                        </>
                    )}
                    <MenuItem
                        hideChevron
                        Icon={favourited ? FavouriteSolidIcon : FavouriteIcon}
                        label={favourited ? _t("contacts|unfavourite") : _t("contacts|favourite")}
                        onSelect={() => act(() => onFavourite(people, !favourited))}
                    />
                    {/* A batch is already a set of people to merge, so it merges itself rather than picking. */}
                    {batch ? (
                        <MenuItem
                            hideChevron
                            Icon={GroupIcon}
                            label={_t("contacts|merge_selected", { count: people.length })}
                            onSelect={() => act(() => onMerge(people))}
                        />
                    ) : (
                        !!others.length && (
                            <MenuItem
                                Icon={GroupIcon}
                                label={_t("contacts|merge_with")}
                                onSelect={keepOpen(() => setView("merge"))}
                            />
                        )
                    )}
                    {!batch && (
                        <MenuItem
                            Icon={EditIcon}
                            label={_t("contacts|rename")}
                            onSelect={keepOpen(() => setView("rename"))}
                        />
                    )}
                    {/*
                     * Out to the network's own app, for whatever a bridge does not carry. Only the accounts
                     * whose network publishes a link for them appear, so nothing here leads nowhere.
                     */}
                    {!batch &&
                        links.map(({ account, link }) => (
                            <MenuItem
                                hideChevron
                                key={`${account.network}:${account.remoteId}`}
                                as="a"
                                href={link.url}
                                target="_blank"
                                rel="noreferrer noopener"
                                Icon={ExternalIcon}
                                label={_t("contacts|open_on", { network: account.network })}
                                onSelect={() => change(false)}
                            >
                                <NetworkLogo client={client} roomId={account.roomId} size={20} />
                            </MenuItem>
                        ))}
                    {/* Filing somebody, which on a phone is what Lists are for. */}
                    {!batch && !!lists?.length && onList && (
                        <MenuItem
                            Icon={ListIcon}
                            label={_t("contacts|add_to_list")}
                            onSelect={keepOpen(() => setView("lists"))}
                        />
                    )}
                    {!batch && onExport && (
                        <MenuItem
                            hideChevron
                            Icon={ShareIcon}
                            label={_t("contacts|export_vcf")}
                            onSelect={() => act(() => onExport(person))}
                        />
                    )}
                    {!batch && linked && (
                        <MenuItem
                            hideChevron
                            Icon={LinkIcon}
                            label={_t("contacts|separate")}
                            kind="critical"
                            onSelect={() => act(() => onSeparate(person))}
                        />
                    )}
                    {/*
                     * Blocking is every account at once: half-ignoring somebody - blocked on Signal, still
                     * ringing on WhatsApp - is not what the reader asked for when they blocked a person.
                     */}
                    {!batch && onBlock && (
                        <MenuItem
                            hideChevron
                            Icon={BlockIcon}
                            label={blocked ? _t("contacts|unblock") : _t("contacts|block")}
                            kind={blocked ? "primary" : "critical"}
                            onSelect={() => act(() => onBlock(person, !blocked))}
                        />
                    )}
                    {!batch && onSelect && (
                        <MenuItem
                            hideChevron
                            Icon={CheckIcon}
                            label={_t("contacts|select")}
                            onSelect={() => act(() => onSelect(person))}
                        />
                    )}
                </>
            )}

            {(view === "voice" || view === "video") && (
                <>
                    <MenuItem
                        hideChevron
                        Icon={BackIcon}
                        label={_t("action|back")}
                        onSelect={keepOpen(() => setView("root"))}
                    />
                    <MenuTitle title={view === "video" ? _t("contacts|video_call") : _t("contacts|call")} />
                    {chats.map((account) => (
                        <ChatItem
                            key={account.roomId}
                            client={client}
                            roomId={account.roomId}
                            label={account.network}
                            Icon={view === "video" ? VideoCallIcon : VoiceCallIcon}
                            onSelect={() => act(() => onCall(person, account.roomId!, view === "video"))}
                        />
                    ))}
                </>
            )}

            {view === "merge" && (
                <>
                    <MenuItem
                        hideChevron
                        Icon={BackIcon}
                        label={_t("action|back")}
                        onSelect={keepOpen(() => setView("root"))}
                    />
                    <MenuTitle title={_t("contacts|merge_with")} />
                    {/*
                     * Typed here rather than on another screen: the list of who somebody might also be is
                     * long, and the answer is nearly always one name the reader already has in mind.
                     */}
                    <Form.Root
                        className="mx_PersonMenu_find"
                        onSubmit={(event) => {
                            event.preventDefault();
                            if (candidates.length) act(() => onMerge([person, candidates[0]]));
                        }}
                    >
                        <Form.Field name="find">
                            <Form.TextControl
                                value={query}
                                placeholder={_t("contacts|search_people")}
                                onChange={(event) => setQuery(event.target.value)}
                                autoFocus
                            />
                        </Form.Field>
                    </Form.Root>
                    {candidates.map((other) => (
                        <MenuItem
                            hideChevron
                            key={other.id}
                            Icon={GroupIcon}
                            label={other.name}
                            onSelect={() => act(() => onMerge([person, other]))}
                        />
                    ))}
                </>
            )}

            {view === "lists" && (
                <>
                    <MenuItem
                        hideChevron
                        Icon={BackIcon}
                        label={_t("action|back")}
                        onSelect={keepOpen(() => setView("root"))}
                    />
                    <MenuTitle title={_t("contacts|lists")} />
                    {(lists ?? []).map((one) => {
                        const member = inList(one, person);
                        return (
                            <MenuItem
                                hideChevron
                                key={one.id}
                                Icon={member ? CheckIcon : ListIcon}
                                label={one.name}
                                onSelect={() => act(() => onList?.(one, !member))}
                            />
                        );
                    })}
                </>
            )}

            {view === "rename" && (
                <>
                    <MenuItem
                        hideChevron
                        Icon={BackIcon}
                        label={_t("action|back")}
                        onSelect={keepOpen(() => setView("root"))}
                    />
                    <MenuTitle title={_t("contacts|rename")} />
                    <Form.Root
                        className="mx_PersonMenu_find"
                        onSubmit={(event) => {
                            event.preventDefault();
                            const wanted = name.trim();
                            if (wanted) act(() => onRename(person, wanted));
                        }}
                    >
                        <Form.Field name="name">
                            <Form.TextControl
                                value={name}
                                placeholder={person.name}
                                onChange={(event) => setName(event.target.value)}
                                autoFocus
                            />
                        </Form.Field>
                    </Form.Root>
                </>
            )}
        </Menu>
    );
}
