/*
Copyright 2024 New Vector Ltd.
Copyright 2021-2023 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type WebSearch as WebSearchEvent } from "@matrix-org/analytics-events/types/typescript/WebSearch";
import { capitalize, sum } from "lodash";
import {
    type HierarchyRoom,
    type IPublicRoomsChunkRoom,
    JoinRule,
    type MatrixClient,
    type Room,
    RoomMember,
    RoomType,
} from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";
import classNames from "classnames";
import React, {
    type ChangeEvent,
    type JSX,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { sanitizeHtml } from "@element-hq/element-web-shared-utils";
import {
    ChatIcon,
    RoomIcon,
    HomeIcon,
    GroupIcon,
    CloseIcon,
    SearchIcon,
    LinkIcon,
    SettingsIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";

import { KeyBindingAction } from "../../../../accessibility/KeyboardShortcuts";
import {
    findNextSiblingElement,
    RovingStateActionType,
    RovingTabIndexContext,
    RovingTabIndexProvider,
} from "../../../../accessibility/RovingTabIndex";
import { mediaFromMxc } from "../../../../customisations/Media";
import { Action } from "../../../../dispatcher/actions";
import defaultDispatcher from "../../../../dispatcher/dispatcher";
import { type ViewRoomPayload } from "../../../../dispatcher/payloads/ViewRoomPayload";
import { useDebouncedCallback } from "../../../../hooks/spotlight/useDebouncedCallback";
import {
    rememberRecentMessageSearch,
    rememberRecentRoom,
    useRecentMessageSearches,
    useRecentSearches,
} from "../../../../hooks/spotlight/useRecentSearches";
import { useProfileInfo } from "../../../../hooks/useProfileInfo";
import { usePublicRoomDirectory } from "../../../../hooks/usePublicRoomDirectory";
import { useSpaceResults } from "../../../../hooks/useSpaceResults";
import { useUserDirectory } from "../../../../hooks/useUserDirectory";
import { useNetworkPeople } from "../../../../hooks/useNetworkPeople";
import { contextOf } from "../../../../utils/bridge/networkPeople";
import { getKeyBindingsManager } from "../../../../KeyBindingsManager";
import { _t } from "../../../../languageHandler";
import { MatrixClientPeg } from "../../../../MatrixClientPeg";
import { PosthogAnalytics } from "../../../../PosthogAnalytics";
import { getCachedRoomIdForAlias } from "../../../../RoomAliasCache";
import { showStartChatInviteDialog } from "../../../../RoomInvite";
import SettingsStore from "../../../../settings/SettingsStore";
import { BreadcrumbsStore } from "../../../../stores/BreadcrumbsStore";
import { type RoomNotificationState } from "../../../../stores/notifications/RoomNotificationState";
import { RoomNotificationStateStore } from "../../../../stores/notifications/RoomNotificationStateStore";
import { compareRoomsByRecency } from "../../../../utils/room/sortRoomsByRecency";
import { SDKContextClass } from "../../../../contexts/SDKContextClass";
import { getMetaSpaceName, MetaSpace } from "../../../../stores/spaces";
import { DirectoryMember, type Member, startDmOnFirstMessage } from "../../../../utils/direct-messages";
import DMRoomMap from "../../../../utils/DMRoomMap";
import { fuzzyMatch } from "../../../../utils/search/fuzzy";
import { makeUserPermalink } from "../../../../utils/permalinks/Permalinks";
import { buildActivityScores, buildMemberScores, compareMembers } from "../../../../utils/SortMembers";
import { copyPlaintext } from "../../../../utils/strings";
import BaseAvatar from "../../avatars/BaseAvatar";
import DecoratedRoomAvatar from "../../avatars/DecoratedRoomAvatar";
import { SearchResultAvatar } from "../../avatars/SearchResultAvatar";
import { NetworkDropdown } from "../../directory/NetworkDropdown";
import AccessibleButton, { type ButtonEvent } from "../../elements/AccessibleButton";
import Spinner from "../../elements/Spinner";
import { NotificationBadge } from "../../rooms/NotificationBadge/NotificationBadge";
import BaseDialog from "../BaseDialog";
import { Option } from "./Option";
import { PublicRoomResultDetails } from "./PublicRoomResultDetails";
import { RoomResultContextMenus } from "./RoomResultContextMenus";
import { RoomContextDetails } from "../../rooms/RoomContextDetails";
import { TooltipOption } from "./TooltipOption";
import { isLocalRoom } from "../../../../utils/localRoom/isLocalRoom";
import RoomAvatar from "../../avatars/RoomAvatar";
import { useFeatureEnabled } from "../../../../hooks/useSettings";
import { filterBoolean } from "../../../../utils/arrays";
import { transformSearchTerm } from "../../../../utils/SearchInput";
import { Filter } from "./Filter";
import { PillTabs, type PillTab } from "../../elements/PillTabs";
import { SpotlightEmptyState } from "./SpotlightEmptyState";
import { MessageFilterChips, MessageResults } from "./MessageResults";
import { NO_MESSAGE_FILTER, type MessageFilter } from "./messageFilters";
import { type MessageHit, useMessageSearch } from "./useMessageSearch";
import { ScreenSize, useScreenSize } from "../../../../utils/telegram/tgLayout/mediaSizes";
import { useUserSettingsSections } from "../../settings/userSettingsSections";
import { searchSettings } from "../../settings/settingsSearch";
import { type OpenToTabPayload } from "../../../../dispatcher/payloads/OpenToTabPayload";

const SETTINGS_LIMIT = 6; // a few: the search is mostly for chats, and the settings' own list has the rest
const SECTION_LIMIT = 50; // only show 50 results per section for performance reasons
const AVATAR_SIZE = "24px";

interface IProps {
    initialText?: string;
    initialFilter?: Filter;
    onFinished(this: void): void;
}

function nodeIsForRecentlyViewed(node?: HTMLElement): boolean {
    return node?.id?.startsWith("mx_SpotlightDialog_button_recentlyViewed_") === true;
}

function getRoomTypes(filter: Filter | null): Set<RoomType | null> {
    const roomTypes = new Set<RoomType | null>();

    if (filter === Filter.PublicRooms) roomTypes.add(null);
    if (filter === Filter.PublicSpaces) roomTypes.add(RoomType.Space);

    return roomTypes;
}

enum Section {
    People,
    Rooms,
    Spaces,
    Suggestions,
    PublicRoomsAndSpaces,
}

function filterToLabel(filter: Filter): string {
    switch (filter) {
        case Filter.People:
            return _t("common|people");
        case Filter.PublicRooms:
            return _t("spotlight_dialog|public_rooms_label");
        case Filter.PublicSpaces:
            return _t("spotlight_dialog|public_spaces_label");
        case Filter.Messages:
            return _t("spotlight_dialog|messages_label");
    }
}

function metaspaceToIcon(key: MetaSpace): JSX.Element | undefined {
    switch (key) {
        case MetaSpace.Home:
            return <HomeIcon />;
        case MetaSpace.Orphans:
            return <RoomIcon />;
    }
}

interface IBaseResult {
    section: Section;
    filter: Filter[];
    query?: string[]; // extra fields to query match, stored as lowercase
}

interface IPublicRoomResult extends IBaseResult {
    publicRoom: IPublicRoomsChunkRoom;
}

interface IRoomResult extends IBaseResult {
    room: Room;
}

interface IMemberResult extends IBaseResult {
    member: Member | RoomMember;
    /**
     * If the result is from a filtered server API then we set true here to avoid locally culling it in our own filters
     */
    alreadyFiltered: boolean;
}

interface IResult extends IBaseResult {
    avatar: JSX.Element;
    name: string;
    description?: string;
    onClick?(this: void): void;
}

type Result = IRoomResult | IPublicRoomResult | IMemberResult | IResult;

const isRoomResult = (result: any): result is IRoomResult => !!result?.room;
const isPublicRoomResult = (result: any): result is IPublicRoomResult => !!result?.publicRoom;
const isMemberResult = (result: any): result is IMemberResult => !!result?.member;

const toPublicRoomResult = (publicRoom: IPublicRoomsChunkRoom): IPublicRoomResult => ({
    publicRoom,
    section: Section.PublicRoomsAndSpaces,
    filter: [Filter.PublicRooms, Filter.PublicSpaces],
    query: filterBoolean([
        publicRoom.room_id.toLowerCase(),
        publicRoom.canonical_alias?.toLowerCase(),
        publicRoom.name?.toLowerCase(),
        sanitizeHtml(publicRoom.topic?.toLowerCase() ?? "", { allowedTags: [] }),
        ...(publicRoom.aliases?.map((it) => it.toLowerCase()) || []),
    ]),
});

const toRoomResult = (room: Room): IRoomResult => {
    const myUserId = MatrixClientPeg.safeGet().getUserId();
    const otherUserId = DMRoomMap.shared().getUserIdForRoomId(room.roomId);

    if (otherUserId) {
        const otherMembers = room.getMembers().filter((it) => it.userId !== myUserId);
        const query = [
            ...otherMembers.map((it) => it.name.toLowerCase()),
            ...otherMembers.map((it) => it.userId.toLowerCase()),
        ].filter(Boolean);
        return {
            room,
            section: Section.People,
            filter: [Filter.People],
            query,
        };
    } else if (room.isSpaceRoom()) {
        return {
            room,
            section: Section.Spaces,
            filter: [],
        };
    } else {
        return {
            room,
            section: Section.Rooms,
            filter: [],
        };
    }
};

const toMemberResult = (member: Member | RoomMember, alreadyFiltered: boolean): IMemberResult => ({
    alreadyFiltered,
    member,
    section: Section.Suggestions,
    filter: [Filter.People],
    query: [member.userId.toLowerCase(), member.name.toLowerCase()].filter(Boolean),
});

export const useWebSearchMetrics = (numResults: number, queryLength: number, viaSpotlight: boolean): void => {
    useEffect(() => {
        if (!queryLength) return;

        // send metrics after a 1s debounce
        const timeoutId = window.setTimeout(() => {
            PosthogAnalytics.instance.trackEvent<WebSearchEvent>({
                eventName: "WebSearch",
                viaSpotlight,
                numResults,
                queryLength,
            });
        }, 1000);

        return () => {
            clearTimeout(timeoutId);
        };
    }, [numResults, queryLength, viaSpotlight]);
};

const findVisibleRooms = (cli: MatrixClient, msc3946ProcessDynamicPredecessor: boolean): Room[] => {
    return cli.getVisibleRooms(msc3946ProcessDynamicPredecessor).filter((room) => {
        // Do not show local rooms
        if (isLocalRoom(room)) return false;

        // TODO we may want to put invites in their own list
        return room.getMyMembership() === KnownMembership.Join || room.getMyMembership() == KnownMembership.Invite;
    });
};

const findVisibleRoomMembers = (visibleRooms: Room[], cli: MatrixClient, filterDMs = true): RoomMember[] => {
    return Object.values(
        visibleRooms
            .filter((room) => !filterDMs || !DMRoomMap.shared().getUserIdForRoomId(room.roomId))
            .reduce(
                (members, room) => {
                    for (const member of room.getJoinedMembers()) {
                        members[member.userId] = member;
                    }
                    return members;
                },
                {} as Record<string, RoomMember>,
            ),
    ).filter((it) => it.userId !== cli.getUserId());
};

const roomAriaUnreadLabel = (room: Room, notification: RoomNotificationState): string | undefined => {
    if (notification.hasMentions) {
        return _t("a11y|n_unread_messages_mentions", {
            count: notification.count,
        });
    } else if (notification.hasUnreadCount) {
        return _t("a11y|n_unread_messages", {
            count: notification.count,
        });
    } else if (notification.isUnread) {
        return _t("a11y|unread_messages");
    } else {
        return undefined;
    }
};

const canAskToJoin = (joinRule?: JoinRule): boolean => {
    return SettingsStore.getValue("feature_ask_to_join") && JoinRule.Knock === joinRule;
};

interface IDirectoryOpts {
    limit: number;
    query: string;
}

const SpotlightDialog: React.FC<IProps> = ({ initialText = "", initialFilter = null, onFinished }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const cli = MatrixClientPeg.safeGet();
    const rovingContext = useContext(RovingTabIndexContext);
    /* On a handheld this is the whole screen, not a window over the chat list: see the chrome below. */
    const handheld = useScreenSize() === ScreenSize.mobile;
    const [query, _setQuery] = useState(initialText);
    const [recentSearches, clearRecentSearches] = useRecentSearches();
    const [recentMessageSearches, clearRecentMessageSearches] = useRecentMessageSearches();
    const [filter, setFilterInternal] = useState<Filter | null>(initialFilter);
    const setFilter = useCallback((filter: Filter | null) => {
        setFilterInternal(filter);
        inputRef.current?.focus();
        scrollContainerRef.current?.scrollTo?.({ top: 0 });
    }, []);
    const [messageFilter, setMessageFilter] = useState<MessageFilter>(NO_MESSAGE_FILTER);
    const memberComparator = useMemo(() => {
        const activityScores = buildActivityScores(cli);
        const memberScores = buildMemberScores(cli);
        return compareMembers(activityScores, memberScores);
    }, [cli]);
    const msc3946ProcessDynamicPredecessor = useFeatureEnabled("feature_dynamic_room_predecessors");

    const ownInviteLink = makeUserPermalink(cli.getUserId()!);
    const [inviteLinkCopied, setInviteLinkCopied] = useState<boolean>(false);
    const trimmedQuery = useMemo(() => query.trim(), [query]);

    const [supportsSpaceFiltering, setSupportsSpaceFiltering] = useState(true); // assume it does until we find out it doesn't
    useEffect(() => {
        void cli
            .isVersionSupported("v1.4")
            .then((supported) => {
                return supported || cli.doesServerSupportUnstableFeature("org.matrix.msc3827.stable");
            })
            .then((supported) => {
                setSupportsSpaceFiltering(supported);
            });
    }, [cli]);

    const {
        loading: publicRoomsLoading,
        publicRooms,
        protocols,
        config,
        setConfig,
        search: searchPublicRooms,
        error: publicRoomsError,
    } = usePublicRoomDirectory();
    const { loading: peopleLoading, users: userDirectorySearchResults, search: searchPeople } = useUserDirectory();
    // The bridged networks searched directly, so somebody never bridged can still be found (useNetworkPeople).
    const { loading: networkPeopleLoading, users: networkPeople, search: searchNetworks } = useNetworkPeople();
    const { loading: profileLoading, profile, search: searchProfileInfo } = useProfileInfo();
    const searchParams: [IDirectoryOpts] = useMemo(
        () => [
            {
                query: trimmedQuery,
                roomTypes: getRoomTypes(filter),
                limit: SECTION_LIMIT,
            },
        ],
        [trimmedQuery, filter],
    );
    useDebouncedCallback(
        filter === Filter.PublicRooms || filter === Filter.PublicSpaces,
        searchPublicRooms,
        searchParams,
    );
    /*
     * People are looked up whether or not the search is filtered to people.
     *
     * Somebody typing a name into search is looking for that person, and needing to pick a filter first to be
     * shown anyone you have not already got a chat with is a step nobody takes: the results looked complete
     * without it. The bridged networks are asked at the same time (utils/bridge/networkPeople.ts), so a
     * Signal, WhatsApp or Messenger contact you have never messaged is findable by name too.
     */
    const lookingForPeople = filter === Filter.People || filter === null;
    /*
     * What was said is looked up the same way: alongside the chats and people in the unfiltered view (a few
     * hits, "Show all" for the rest) and as the whole view under the Messages filter. Only the whole view
     * has the chips to apply, so the preview is not narrowed by a filter that is not on screen.
     */
    const lookingForMessages = filter === null || filter === Filter.Messages;
    const messageSearch = useMessageSearch(
        cli,
        trimmedQuery,
        lookingForMessages,
        filter === Filter.Messages ? messageFilter : NO_MESSAGE_FILTER,
    );
    useDebouncedCallback(lookingForPeople, searchPeople, searchParams);
    useDebouncedCallback(lookingForPeople, searchProfileInfo, searchParams);
    useDebouncedCallback(lookingForPeople, searchNetworks, searchParams);

    const possibleResults = useMemo<Result[]>(() => {
        const visibleRooms = findVisibleRooms(cli, msc3946ProcessDynamicPredecessor);
        const roomResults = visibleRooms.map(toRoomResult);
        const userResults: IMemberResult[] = [];

        // If we already have a DM with the user we're looking for, we will show that DM instead of the user themselves
        const alreadyAddedUserIds = roomResults.reduce((userIds, result) => {
            const userId = DMRoomMap.shared().getUserIdForRoomId(result.room.roomId);
            if (!userId) return userIds;
            if (result.room.getJoinedMemberCount() > 2) return userIds;
            userIds.set(userId, result);
            return userIds;
        }, new Map<string, IMemberResult | IRoomResult>());

        function addUserResults(users: Array<Member | RoomMember>, alreadyFiltered: boolean): void {
            for (const user of users) {
                // Make sure we don't have any user more than once
                if (alreadyAddedUserIds.has(user.userId)) {
                    const result = alreadyAddedUserIds.get(user.userId)!;
                    if (alreadyFiltered && isMemberResult(result) && !result.alreadyFiltered) {
                        // But if they were added as not yet filtered then mark them as already filtered to avoid
                        // culling this result based on local filtering.
                        result.alreadyFiltered = true;
                    }
                    continue;
                }
                const result = toMemberResult(user, alreadyFiltered);
                alreadyAddedUserIds.set(user.userId, result);
                userResults.push(result);
            }
        }
        addUserResults(findVisibleRoomMembers(visibleRooms, cli), false);
        addUserResults(userDirectorySearchResults, true);
        addUserResults(networkPeople, true);
        if (profile) {
            addUserResults([new DirectoryMember(profile)], true);
        }

        return [
            ...SDKContextClass.instance.spaceStore.enabledMetaSpaces.map((spaceKey) => ({
                section: Section.Spaces,
                filter: [] as Filter[],
                avatar: <div className="mx_SpotlightDialog_metaspaceResult">{metaspaceToIcon(spaceKey)}</div>,
                name: getMetaSpaceName(spaceKey, SDKContextClass.instance.spaceStore.allRoomsInHome),
                onClick() {
                    SDKContextClass.instance.spaceStore.setActiveSpace(spaceKey);
                },
            })),
            ...roomResults,
            ...userResults,
            ...publicRooms.map(toPublicRoomResult),
        ].filter((result) => filter === null || result.filter.includes(filter));
    }, [
        cli,
        userDirectorySearchResults,
        networkPeople,
        profile,
        publicRooms,
        filter,
        msc3946ProcessDynamicPredecessor,
    ]);

    // The settings, by the same index the settings' own search reads: only when searching everything.
    const settingsSections = useUserSettingsSections();
    const settingsResults = useMemo(
        () => (filter === null && trimmedQuery ? searchSettings(trimmedQuery, settingsSections, SETTINGS_LIMIT) : []),
        [filter, trimmedQuery, settingsSections],
    );

    const results = useMemo<Record<Section, Result[]>>(() => {
        const results: Record<Section, Result[]> = {
            [Section.People]: [],
            [Section.Rooms]: [],
            [Section.Spaces]: [],
            [Section.Suggestions]: [],
            [Section.PublicRoomsAndSpaces]: [],
        };

        // Group results in their respective sections
        if (trimmedQuery) {
            /*
             * Every candidate is matched in one pass (utils/search/fuzzy.ts), which is what makes a
             * typo, an accent or two words in the wrong order still find the thing: a per-entry
             * substring test can do none of those, and compiling the query once per entry instead of
             * once is the difference between instant and not.
             *
             * What each kind of result offers to match against is what it already carried: a room its
             * name and alias, everything else its `query` strings. Only membership is decided here -
             * the sections are sorted by activity below, the way they always were.
             */
            const keysOf = (entry: Result): (string | undefined)[] => {
                if (isRoomResult(entry)) {
                    return [entry.room.name, entry.room.getCanonicalAlias() ?? undefined, ...(entry.query ?? [])];
                }
                if (isMemberResult(entry) || isPublicRoomResult(entry)) return entry.query ?? [];
                return [entry.name, ...(entry.query ?? [])];
            };
            const matched = new Set(
                fuzzyMatch(
                    possibleResults.map((entry) => ({ item: entry, keys: keysOf(entry) })),
                    trimmedQuery,
                ).map((match) => match.item),
            );

            possibleResults.forEach((entry) => {
                if (isRoomResult(entry)) {
                    // If the room is a DM with a user that is part of the user directory search results,
                    // we can assume the user is a relevant result, so include the DM with them too.
                    const userId = DMRoomMap.shared().getUserIdForRoomId(entry.room.roomId);
                    if (userDirectorySearchResults.some((user) => user.userId === userId)) {
                        results[entry.section].push(entry);
                        return;
                    }
                } else if (isMemberResult(entry) && entry.alreadyFiltered) {
                    // The server already decided this one matches; second-guessing it would drop
                    // people it found on a network and we have nothing here to match them by.
                    results[entry.section].push(entry);
                    return;
                }

                if (!matched.has(entry)) return; // bail, does not match query

                results[entry.section].push(entry);
            });
        } else if (filter === Filter.PublicRooms || filter === Filter.PublicSpaces) {
            // return all results for public rooms if no query is given
            possibleResults.forEach((entry) => {
                if (isPublicRoomResult(entry)) {
                    results[entry.section].push(entry);
                }
            });
        } else if (filter === Filter.People) {
            // return all results for people if no query is given
            possibleResults.forEach((entry) => {
                if (isMemberResult(entry)) {
                    results[entry.section].push(entry);
                }
            });
        }

        // Sort results by most recent activity
        const myUserId = cli.getSafeUserId();
        for (const resultArray of Object.values(results)) {
            resultArray.sort((a: Result, b: Result) => {
                if (isRoomResult(a) || isRoomResult(b)) {
                    // Room results should appear at the top of the list
                    if (!isRoomResult(b)) return -1;
                    if (!isRoomResult(a)) return -1;

                    return compareRoomsByRecency(a.room, b.room, myUserId);
                } else if (isMemberResult(a) || isMemberResult(b)) {
                    // Member results should appear just after room results
                    if (!isMemberResult(b)) return -1;
                    if (!isMemberResult(a)) return -1;

                    return memberComparator(a.member, b.member);
                }
                return 0;
            });
        }

        return results;
    }, [cli, trimmedQuery, filter, possibleResults, userDirectorySearchResults, memberComparator]);

    const numResults = sum(Object.values(results).map((it) => it.length));
    useWebSearchMetrics(numResults, query.length, true);

    const activeSpace = SDKContextClass.instance.spaceStore.activeSpaceRoom;
    const [spaceResults, spaceResultsLoading] = useSpaceResults(activeSpace ?? undefined, query);

    const setQuery = (e: ChangeEvent<HTMLInputElement>): void => {
        const newQuery = transformSearchTerm(e.currentTarget.value);
        _setQuery(newQuery);
    };
    useEffect(() => {
        const timer = setTimeout(() => {
            const node = rovingContext.state.nodes[0];
            if (node) {
                rovingContext.dispatch({
                    type: RovingStateActionType.SetFocus,
                    payload: { node },
                });
                node?.scrollIntoView?.({
                    block: "nearest",
                });
            }
        });
        return () => clearTimeout(timer);
        // we intentionally ignore changes to the rovingContext for the purpose of this hook
        // we only want to reset the focus whenever the results or filters change. The messages are results too:
        // when the first page lands, or a chip narrows them, the entry first in the list may be a different one.
        // A further page added to the end is not a new set of results: following the number of hits here
        // threw the list back to its top every time it was scrolled far enough to fetch more.
        // oxlint-disable-next-line react-hooks/exhaustive-deps
    }, [results, filter, messageFilter, messageSearch.loading, messageSearch.hits.length > 0]);

    const viewRoom = (
        room: {
            roomId: string;
            /** The message to open the chat at, for a hit in the Messages group. */
            eventId?: string;
            roomAlias?: string;
            autoJoin?: boolean;
            shouldPeek?: boolean;
            viaServers?: string[];
            joinRule?: IPublicRoomsChunkRoom["join_rule"];
        },
        persist = false,
        viaKeyboard = false,
    ): void => {
        if (persist) rememberRecentRoom(room.roomId);

        defaultDispatcher.dispatch<ViewRoomPayload>({
            action: Action.ViewRoom,
            metricsTrigger: "WebUnifiedSearch",
            metricsViaKeyboard: viaKeyboard,
            room_id: room.roomId,
            event_id: room.eventId,
            highlighted: room.eventId ? true : undefined,
            room_alias: room.roomAlias,
            auto_join: room.autoJoin && !canAskToJoin(room.joinRule),
            should_peek: room.shouldPeek,
            via_servers: room.viaServers,
        });

        if (canAskToJoin(room.joinRule)) {
            defaultDispatcher.dispatch({ action: Action.PromptAskToJoin });
        }

        onFinished();
    };

    const openMessage = (hit: MessageHit, ev?: { type: string }): void => {
        rememberRecentMessageSearch(trimmedQuery);
        viewRoom({ roomId: hit.room.roomId, eventId: hit.event.getId() }, true, ev?.type !== "click");
    };

    /*
     * The chats recently opened from the search, whichever tab they were found under. Every tab offers them
     * while nothing is typed, narrowed to what the tab is for, so switching tabs does not lose them.
     */
    const recentRoomsSection = (rooms: Room[]): JSX.Element | undefined => {
        if (!rooms.length) return undefined;
        return (
            <div
                className="mx_SpotlightDialog_section mx_SpotlightDialog_recentSearches"
                role="group"
                // Firefox sometimes makes this element focusable due to overflow,
                // so force it out of tab order by default.
                tabIndex={-1}
                aria-labelledby="mx_SpotlightDialog_section_recentSearches"
            >
                <h4>
                    <span id="mx_SpotlightDialog_section_recentSearches">
                        {_t("spotlight_dialog|recent_searches_section_title")}
                    </span>
                    <AccessibleButton kind="link" onClick={clearRecentSearches}>
                        {_t("action|clear")}
                    </AccessibleButton>
                </h4>
                <div>
                    {rooms.map((room) => {
                        const notification = RoomNotificationStateStore.instance.getRoomState(room);
                        const unreadLabel = roomAriaUnreadLabel(room, notification);
                        const ariaProperties = {
                            "aria-label": unreadLabel ? `${room.name} ${unreadLabel}` : room.name,
                            "aria-describedby": `mx_SpotlightDialog_button_recentSearch_${room.roomId}_details`,
                        };
                        return (
                            <Option
                                id={`mx_SpotlightDialog_button_recentSearch_${room.roomId}`}
                                key={room.roomId}
                                onClick={(ev) => {
                                    viewRoom({ roomId: room.roomId }, true, ev?.type !== "click");
                                }}
                                endAdornment={<RoomResultContextMenus room={room} />}
                                {...ariaProperties}
                            >
                                <DecoratedRoomAvatar room={room} size={AVATAR_SIZE} tooltipProps={{ tabIndex: -1 }} />
                                {room.name}
                                <NotificationBadge
                                    notification={notification}
                                    className="mx_SpotlightDialog_notificationBadge"
                                />
                                <RoomContextDetails
                                    id={`mx_SpotlightDialog_button_recentSearch_${room.roomId}_details`}
                                    className="mx_SpotlightDialog_result_details"
                                    room={room}
                                />
                            </Option>
                        );
                    })}
                </div>
            </div>
        );
    };

    /** The words recently used to find a message: pressing one searches for it again. */
    const recentMessageSearchesSection = (): JSX.Element | undefined => {
        if (!recentMessageSearches.length) return undefined;
        return (
            <div
                className="mx_SpotlightDialog_section mx_SpotlightDialog_results mx_SpotlightDialog_recentMessageSearches"
                role="group"
                aria-labelledby="mx_SpotlightDialog_section_recentMessageSearches"
            >
                <h4>
                    <span id="mx_SpotlightDialog_section_recentMessageSearches">
                        {_t("spotlight_dialog|recent_searches_section_title")}
                    </span>
                    <AccessibleButton kind="link" onClick={clearRecentMessageSearches}>
                        {_t("action|clear")}
                    </AccessibleButton>
                </h4>
                <div>
                    {recentMessageSearches.map((term) => (
                        <Option
                            id={`mx_SpotlightDialog_button_recentMessageSearch_${term}`}
                            key={term}
                            onClick={() => {
                                _setQuery(term);
                                inputRef.current?.focus();
                            }}
                        >
                            <SearchIcon />
                            <span className="mx_SpotlightDialog_result_name">{term}</span>
                        </Option>
                    ))}
                </div>
            </div>
        );
    };

    let content: JSX.Element;
    if (filter === Filter.Messages) {
        // The whole view is the Messages group: nothing else is looked for, so nothing else is offered.
        content = trimmedQuery ? (
            <MessageResults search={messageSearch} term={trimmedQuery} onOpen={(hit) => openMessage(hit)} />
        ) : (
            <>
                {recentMessageSearchesSection()}
                <SpotlightEmptyState
                    className="mx_SpotlightDialog_messagesHint"
                    icon={<ChatIcon />}
                    title={_t("spotlight_dialog|messages_hint_title")}
                    description={_t("spotlight_dialog|messages_hint")}
                />
            </>
        );
    } else if (trimmedQuery || filter !== null) {
        const resultMapper = (result: Result): JSX.Element => {
            if (isRoomResult(result)) {
                const notification = RoomNotificationStateStore.instance.getRoomState(result.room);
                const unreadLabel = roomAriaUnreadLabel(result.room, notification);
                const ariaProperties = {
                    "aria-label": unreadLabel ? `${result.room.name} ${unreadLabel}` : result.room.name,
                    "aria-describedby": `mx_SpotlightDialog_button_result_${result.room.roomId}_details`,
                };
                return (
                    <Option
                        id={`mx_SpotlightDialog_button_result_${result.room.roomId}`}
                        key={`${Section[result.section]}-${result.room.roomId}`}
                        onClick={(ev) => {
                            viewRoom({ roomId: result.room.roomId }, true, ev?.type !== "click");
                        }}
                        endAdornment={<RoomResultContextMenus room={result.room} />}
                        {...ariaProperties}
                    >
                        <DecoratedRoomAvatar room={result.room} size={AVATAR_SIZE} tooltipProps={{ tabIndex: -1 }} />
                        <span className="mx_SpotlightDialog_result_name" title={result.room.name}>
                            {result.room.name}
                        </span>
                        <NotificationBadge
                            notification={notification}
                            className="mx_SpotlightDialog_notificationBadge"
                        />
                        <RoomContextDetails
                            id={`mx_SpotlightDialog_button_result_${result.room.roomId}_details`}
                            className="mx_SpotlightDialog_result_details"
                            room={result.room}
                        />
                    </Option>
                );
            }
            if (isMemberResult(result)) {
                return (
                    <Option
                        id={`mx_SpotlightDialog_button_result_${result.member.userId}`}
                        key={`${Section[result.section]}-${result.member.userId}`}
                        onClick={() => {
                            // The chat with them is what the recent searches can offer again; a chat that
                            // exists only locally until the first message is sent is not one yet.
                            void startDmOnFirstMessage(cli, [result.member]).then((roomId) => {
                                if (roomId && cli.getRoom(roomId) && !isLocalRoom(roomId)) rememberRecentRoom(roomId);
                            });
                            onFinished();
                        }}
                        aria-label={
                            result.member instanceof RoomMember ? result.member.rawDisplayName : result.member.name
                        }
                        aria-describedby={`mx_SpotlightDialog_button_result_${result.member.userId}_details`}
                    >
                        <SearchResultAvatar user={result.member} size={AVATAR_SIZE} />
                        <span
                            className="mx_SpotlightDialog_result_name"
                            title={
                                result.member instanceof RoomMember ? result.member.rawDisplayName : result.member.name
                            }
                        >
                            {result.member instanceof RoomMember ? result.member.rawDisplayName : result.member.name}
                        </span>
                        <div
                            id={`mx_SpotlightDialog_button_result_${result.member.userId}_details`}
                            className="mx_SpotlightDialog_result_details"
                        >
                            {contextOf(result.member) ?? result.member.userId}
                        </div>
                    </Option>
                );
            }
            if (isPublicRoomResult(result)) {
                const clientRoom = cli.getRoom(result.publicRoom.room_id);
                const joinRule = result.publicRoom.join_rule;
                // Element Web currently does not allow guests to join rooms, so we
                // instead show them view buttons for all rooms. If the room is not
                // world readable, a modal will appear asking you to register first. If
                // it is readable, the preview appears as normal.
                const showViewButton =
                    clientRoom?.getMyMembership() === KnownMembership.Join ||
                    (result.publicRoom.world_readable && !canAskToJoin(joinRule)) ||
                    cli.isGuest();

                const listener = (ev: ButtonEvent): void => {
                    ev.stopPropagation();

                    const { publicRoom } = result;
                    viewRoom(
                        {
                            roomAlias: publicRoom.canonical_alias || publicRoom.aliases?.[0],
                            roomId: publicRoom.room_id,
                            autoJoin: !result.publicRoom.world_readable && !cli.isGuest(),
                            shouldPeek: result.publicRoom.world_readable || cli.isGuest(),
                            viaServers: config ? [config.roomServer] : undefined,
                            joinRule,
                        },
                        true,
                        ev.type !== "click",
                    );
                };

                let buttonLabel;
                if (showViewButton) {
                    buttonLabel = _t("action|view");
                } else {
                    buttonLabel = canAskToJoin(joinRule) ? _t("action|ask_to_join") : _t("action|join");
                }

                return (
                    <Option
                        id={`mx_SpotlightDialog_button_result_${result.publicRoom.room_id}`}
                        className="mx_SpotlightDialog_result_multiline"
                        key={`${Section[result.section]}-${result.publicRoom.room_id}`}
                        onClick={listener}
                        endAdornment={
                            <AccessibleButton
                                kind={showViewButton ? "primary_outline" : "primary"}
                                onClick={listener}
                                tabIndex={-1}
                            >
                                {buttonLabel}
                            </AccessibleButton>
                        }
                        aria-labelledby={`mx_SpotlightDialog_button_result_${result.publicRoom.room_id}_name`}
                        aria-describedby={`mx_SpotlightDialog_button_result_${result.publicRoom.room_id}_alias`}
                        aria-details={`mx_SpotlightDialog_button_result_${result.publicRoom.room_id}_details`}
                    >
                        <RoomAvatar
                            className="mx_SearchResultAvatar"
                            oobData={{
                                roomId: result.publicRoom.room_id,
                                name: result.publicRoom.name,
                                avatarUrl: result.publicRoom.avatar_url,
                                roomType: result.publicRoom.room_type,
                            }}
                            size={AVATAR_SIZE}
                        />
                        <PublicRoomResultDetails
                            room={result.publicRoom}
                            labelId={`mx_SpotlightDialog_button_result_${result.publicRoom.room_id}_name`}
                            descriptionId={`mx_SpotlightDialog_button_result_${result.publicRoom.room_id}_alias`}
                            detailsId={`mx_SpotlightDialog_button_result_${result.publicRoom.room_id}_details`}
                        />
                    </Option>
                );
            }

            // IResult case
            return (
                <Option
                    id={`mx_SpotlightDialog_button_result_${result.name}`}
                    key={`${Section[result.section]}-${result.name}`}
                    onClick={result.onClick ?? null}
                >
                    {result.avatar}
                    {result.name}
                    {result.description}
                </Option>
            );
        };

        let peopleSection: JSX.Element | undefined;
        if (results[Section.People].length) {
            peopleSection = (
                <div
                    className="mx_SpotlightDialog_section mx_SpotlightDialog_results"
                    role="group"
                    aria-labelledby="mx_SpotlightDialog_section_people"
                >
                    <h4 id="mx_SpotlightDialog_section_people">{_t("invite|recents_section")}</h4>
                    <div>{results[Section.People].slice(0, SECTION_LIMIT).map(resultMapper)}</div>
                </div>
            );
        }

        let suggestionsSection: JSX.Element | undefined;
        if (results[Section.Suggestions].length && filter === Filter.People) {
            suggestionsSection = (
                <div
                    className="mx_SpotlightDialog_section mx_SpotlightDialog_results"
                    role="group"
                    aria-labelledby="mx_SpotlightDialog_section_suggestions"
                >
                    <h4 id="mx_SpotlightDialog_section_suggestions">{_t("common|suggestions")}</h4>
                    <div>{results[Section.Suggestions].slice(0, SECTION_LIMIT).map(resultMapper)}</div>
                </div>
            );
        }

        let roomsSection: JSX.Element | undefined;
        if (results[Section.Rooms].length) {
            roomsSection = (
                <div
                    className="mx_SpotlightDialog_section mx_SpotlightDialog_results"
                    role="group"
                    aria-labelledby="mx_SpotlightDialog_section_rooms"
                >
                    <h4 id="mx_SpotlightDialog_section_rooms">{_t("common|rooms")}</h4>
                    <div>{results[Section.Rooms].slice(0, SECTION_LIMIT).map(resultMapper)}</div>
                </div>
            );
        }

        let settingsSection: JSX.Element | undefined;
        if (settingsResults.length) {
            settingsSection = (
                <div
                    className="mx_SpotlightDialog_section mx_SpotlightDialog_results"
                    role="group"
                    aria-labelledby="mx_SpotlightDialog_section_settings"
                >
                    <h4 id="mx_SpotlightDialog_section_settings">{_t("common|settings")}</h4>
                    <div>
                        {settingsResults.map(({ section, label, sectionLabel }) => (
                            <Option
                                id={`mx_SpotlightDialog_button_result_settings_${section}_${label ?? ""}`}
                                key={`settings-${section}-${label ?? ""}`}
                                onClick={() => {
                                    defaultDispatcher.dispatch<OpenToTabPayload>({
                                        action: Action.ViewUserSettings,
                                        initialTabId: section,
                                        props: label ? { highlight: label } : undefined,
                                    });
                                    onFinished();
                                }}
                            >
                                <SettingsIcon />
                                {label ?? sectionLabel}
                                {label && <span className="mx_SpotlightDialog_result_details">{sectionLabel}</span>}
                            </Option>
                        ))}
                    </div>
                </div>
            );
        }

        let spacesSection: JSX.Element | undefined;
        if (results[Section.Spaces].length) {
            spacesSection = (
                <div
                    className="mx_SpotlightDialog_section mx_SpotlightDialog_results"
                    role="group"
                    aria-labelledby="mx_SpotlightDialog_section_spaces"
                >
                    <h4 id="mx_SpotlightDialog_section_spaces">{_t("spotlight_dialog|spaces_title")}</h4>
                    <div>{results[Section.Spaces].slice(0, SECTION_LIMIT).map(resultMapper)}</div>
                </div>
            );
        }

        let publicRoomsSection: JSX.Element | undefined;
        if (filter === Filter.PublicRooms || filter === Filter.PublicSpaces) {
            let content: JSX.Element | JSX.Element[];
            if (publicRoomsError) {
                content = (
                    <div className="mx_SpotlightDialog_otherSearches_messageSearchText">
                        {filter === Filter.PublicRooms
                            ? _t("spotlight_dialog|failed_querying_public_rooms")
                            : _t("spotlight_dialog|failed_querying_public_spaces")}
                    </div>
                );
            } else {
                content = results[Section.PublicRoomsAndSpaces].slice(0, SECTION_LIMIT).map(resultMapper);
            }

            publicRoomsSection = (
                <div
                    className="mx_SpotlightDialog_section mx_SpotlightDialog_results"
                    role="group"
                    aria-labelledby="mx_SpotlightDialog_section_publicRooms"
                >
                    <div className="mx_SpotlightDialog_sectionHeader">
                        <h4 id="mx_SpotlightDialog_section_publicRooms">{_t("common|suggestions")}</h4>
                        <div className="mx_SpotlightDialog_options">
                            <NetworkDropdown protocols={protocols} config={config ?? null} setConfig={setConfig} />
                        </div>
                    </div>
                    <div>{content}</div>
                </div>
            );
        }

        let spaceRoomsSection: JSX.Element | undefined;
        if (spaceResults.length && activeSpace && filter === null) {
            spaceRoomsSection = (
                <div
                    className="mx_SpotlightDialog_section mx_SpotlightDialog_results"
                    role="group"
                    aria-labelledby="mx_SpotlightDialog_section_spaceRooms"
                >
                    <h4 id="mx_SpotlightDialog_section_spaceRooms">
                        {_t("spotlight_dialog|other_rooms_in_space", { spaceName: activeSpace.name })}
                    </h4>
                    <div>
                        {spaceResults.slice(0, SECTION_LIMIT).map((room: HierarchyRoom): JSX.Element => (
                            <Option
                                id={`mx_SpotlightDialog_button_result_${room.room_id}`}
                                key={room.room_id}
                                onClick={(ev) => {
                                    viewRoom({ roomId: room.room_id }, true, ev?.type !== "click");
                                }}
                            >
                                <BaseAvatar
                                    name={room.name}
                                    idName={room.room_id}
                                    url={
                                        room.avatar_url
                                            ? mediaFromMxc(room.avatar_url).getSquareThumbnailHttp(
                                                  parseInt(AVATAR_SIZE, 10),
                                              )
                                            : null
                                    }
                                    size={AVATAR_SIZE}
                                />
                                {room.name || room.canonical_alias}
                                {room.name && room.canonical_alias && (
                                    <div className="mx_SpotlightDialog_result_details">{room.canonical_alias}</div>
                                )}
                            </Option>
                        ))}
                        {spaceResultsLoading && <Spinner />}
                    </div>
                </div>
            );
        }

        let joinRoomSection: JSX.Element | undefined;
        if (
            trimmedQuery.startsWith("#") &&
            trimmedQuery.includes(":") &&
            (!getCachedRoomIdForAlias(trimmedQuery) || !cli.getRoom(getCachedRoomIdForAlias(trimmedQuery)!.roomId))
        ) {
            joinRoomSection = (
                <div className="mx_SpotlightDialog_section mx_SpotlightDialog_otherSearches" role="group">
                    <div>
                        <Option
                            id="mx_SpotlightDialog_button_joinRoomAlias"
                            onClick={(ev) => {
                                defaultDispatcher.dispatch<ViewRoomPayload>({
                                    action: Action.ViewRoom,
                                    room_alias: trimmedQuery,
                                    auto_join: true,
                                    metricsTrigger: "WebUnifiedSearch",
                                    metricsViaKeyboard: ev?.type !== "click",
                                });
                                onFinished();
                            }}
                        >
                            <RoomIcon />
                            {_t("spotlight_dialog|join_button_text", {
                                roomAddress: trimmedQuery,
                            })}
                        </Option>
                    </div>
                </div>
            );
        }

        let hiddenResultsSection: JSX.Element | undefined;
        if (filter === Filter.People) {
            hiddenResultsSection = (
                <div className="mx_SpotlightDialog_section mx_SpotlightDialog_hiddenResults" role="group">
                    <h4>{_t("spotlight_dialog|result_may_be_hidden_privacy_warning")}</h4>
                    <div className="mx_SpotlightDialog_otherSearches_messageSearchText">
                        {_t("spotlight_dialog|cant_find_person_helpful_hint")}
                    </div>
                    <TooltipOption
                        id="mx_SpotlightDialog_button_inviteLink"
                        className="mx_SpotlightDialog_inviteLink"
                        onClick={() => {
                            setInviteLinkCopied(true);
                            void copyPlaintext(ownInviteLink);
                        }}
                        onTooltipOpenChange={(open) => {
                            if (!open) setInviteLinkCopied(false);
                        }}
                        title={inviteLinkCopied ? _t("common|copied") : _t("action|copy")}
                    >
                        <span className="mx_AccessibleButton mx_AccessibleButton_hasKind mx_AccessibleButton_kind_primary_outline">
                            <LinkIcon />
                            {_t("spotlight_dialog|copy_link_text")}
                        </span>
                    </TooltipOption>
                </div>
            );
        } else if (trimmedQuery && (filter === Filter.PublicRooms || filter === Filter.PublicSpaces)) {
            hiddenResultsSection = (
                <div className="mx_SpotlightDialog_section mx_SpotlightDialog_hiddenResults" role="group">
                    <h4>{_t("spotlight_dialog|result_may_be_hidden_warning")}</h4>
                    <div className="mx_SpotlightDialog_otherSearches_messageSearchText">
                        {_t("spotlight_dialog|cant_find_room_helpful_hint")}
                    </div>
                    <Option
                        id="mx_SpotlightDialog_button_createNewRoom"
                        className="mx_SpotlightDialog_createRoom"
                        onClick={() =>
                            defaultDispatcher.dispatch({
                                action: Action.CreateRoom,
                                public: true,
                                defaultName: capitalize(trimmedQuery),
                            })
                        }
                    >
                        <span className="mx_AccessibleButton mx_AccessibleButton_hasKind mx_AccessibleButton_kind_primary_outline">
                            <RoomIcon />
                            {_t("spotlight_dialog|create_new_room_button")}
                        </span>
                    </Option>
                </div>
            );
        }

        let groupChatSection: JSX.Element | undefined;
        if (filter === Filter.People) {
            groupChatSection = (
                <div
                    className="mx_SpotlightDialog_section mx_SpotlightDialog_otherSearches"
                    role="group"
                    aria-labelledby="mx_SpotlightDialog_section_groupChat"
                >
                    <h4 id="mx_SpotlightDialog_section_groupChat">{_t("spotlight_dialog|group_chat_section_title")}</h4>
                    <Option
                        id="mx_SpotlightDialog_button_startGroupChat"
                        onClick={() => showStartChatInviteDialog(trimmedQuery)}
                    >
                        <GroupIcon />
                        {_t("spotlight_dialog|start_group_chat_button")}
                    </Option>
                </div>
            );
        }

        // The shortcuts below the results are options in their own right, so with nothing above them
        // the first one is selected by default and enter drops the user into a filter they never
        // asked for. Saying there are no results gives that default selection somewhere harmless to
        // land, and the shortcuts are still an arrow key away.
        let noResultsSection: JSX.Element | undefined;
        const hasResults =
            !!results[Section.People].length ||
            (filter === Filter.People && !!results[Section.Suggestions].length) ||
            !!results[Section.Rooms].length ||
            !!results[Section.Spaces].length ||
            !!results[Section.PublicRoomsAndSpaces].length ||
            !!settingsResults.length ||
            !!spaceResults.length ||
            !!joinRoomSection;
        // Messages that matched are results too: "No results" over them would be a lie.
        const messagesPending = filter === null && (messageSearch.loading || messageSearch.hits.length > 0);
        if (trimmedQuery && !hasResults && !messagesPending) {
            noResultsSection = (
                <div className="mx_SpotlightDialog_section mx_SpotlightDialog_results" role="group">
                    <Option
                        id="mx_SpotlightDialog_button_noResults"
                        className="mx_SpotlightDialog_noResults"
                        onClick={null}
                    >
                        <SpotlightEmptyState
                            icon={<SearchIcon />}
                            title={_t("spotlight_dialog|no_results")}
                            description={_t("spotlight_dialog|no_results_hint")}
                        />
                    </Option>
                </div>
            );
        }

        let messagesSection: JSX.Element | undefined;
        if (trimmedQuery && filter === null) {
            messagesSection = (
                <MessageResults
                    preview
                    search={messageSearch}
                    term={trimmedQuery}
                    onOpen={(hit) => openMessage(hit)}
                    onShowAll={() => setFilter(Filter.Messages)}
                />
            );
        }

        // With nothing typed, a tab still offers the chats recently found, those that are what it is for.
        let recentSection: JSX.Element | undefined;
        if (!trimmedQuery) {
            const isDm = (room: Room): boolean => !!DMRoomMap.shared().getUserIdForRoomId(room.roomId);
            recentSection = recentRoomsSection(
                recentSearches.filter((room) => {
                    if (filter === Filter.People) return isDm(room);
                    if (filter === Filter.PublicSpaces) return room.isSpaceRoom();
                    return !isDm(room) && !room.isSpaceRoom();
                }),
            );
        }

        content = (
            <>
                {recentSection}
                {noResultsSection}
                {peopleSection}
                {suggestionsSection}
                {roomsSection}
                {spacesSection}
                {spaceRoomsSection}
                {messagesSection}
                {publicRoomsSection}
                {joinRoomSection}
                {/* After the chats: what is typed is a chat's name far more often than a setting's. */}
                {settingsSection}
                {hiddenResultsSection}
                {groupChatSection}
            </>
        );
    } else {
        const recentSearchesSection = recentRoomsSection(recentSearches);

        content = (
            <>
                <div
                    className="mx_SpotlightDialog_section mx_SpotlightDialog_recentlyViewed"
                    role="group"
                    aria-labelledby="mx_SpotlightDialog_section_recentlyViewed"
                >
                    <h4 id="mx_SpotlightDialog_section_recentlyViewed">
                        {_t("spotlight_dialog|recently_viewed_section_title")}
                    </h4>
                    <div>
                        {BreadcrumbsStore.instance.rooms
                            .filter((r) => r.roomId !== SDKContextClass.instance.roomViewStore.getRoomId())
                            .map((room) => (
                                <TooltipOption
                                    id={`mx_SpotlightDialog_button_recentlyViewed_${room.roomId}`}
                                    title={room.name}
                                    key={room.roomId}
                                    onClick={(ev) => {
                                        viewRoom({ roomId: room.roomId }, false, ev.type !== "click");
                                    }}
                                >
                                    <DecoratedRoomAvatar room={room} size="32px" tooltipProps={{ tabIndex: -1 }} />
                                    {room.name}
                                </TooltipOption>
                            ))}
                    </div>
                </div>

                {recentSearchesSection}
            </>
        );
    }

    const onDialogKeyDown = (ev: KeyboardEvent | React.KeyboardEvent): void => {
        const navigationAction = getKeyBindingsManager().getNavigationAction(ev);
        switch (navigationAction) {
            case KeyBindingAction.FilterRooms:
                ev.stopPropagation();
                ev.preventDefault();
                onFinished();
                break;
        }

        let node: HTMLElement | undefined;
        const accessibilityAction = getKeyBindingsManager().getAccessibilityAction(ev);
        switch (accessibilityAction) {
            case KeyBindingAction.Escape:
                ev.stopPropagation();
                ev.preventDefault();
                onFinished();
                break;
            case KeyBindingAction.ArrowUp:
            case KeyBindingAction.ArrowDown:
                ev.stopPropagation();
                ev.preventDefault();

                if (rovingContext.state.activeNode && rovingContext.state.nodes.length > 0) {
                    let nodes = rovingContext.state.nodes;
                    if (!query && filter === null) {
                        // If the current selection is not in the recently viewed row then only include the
                        // first recently viewed so that is the target when the user is switching into recently viewed.
                        const keptRecentlyViewedRef = nodeIsForRecentlyViewed(rovingContext.state.activeNode)
                            ? rovingContext.state.activeNode
                            : nodes.find(nodeIsForRecentlyViewed);
                        // exclude all other recently viewed items from the list so up/down arrows skip them
                        nodes = nodes.filter((ref) => ref === keptRecentlyViewedRef || !nodeIsForRecentlyViewed(ref));
                    }

                    const idx = nodes.indexOf(rovingContext.state.activeNode);
                    node = findNextSiblingElement(
                        nodes,
                        idx + (accessibilityAction === KeyBindingAction.ArrowUp ? -1 : 1),
                    );
                }
                break;

            case KeyBindingAction.ArrowLeft:
            case KeyBindingAction.ArrowRight:
                // only handle these keys when we are in the recently viewed row of options
                if (
                    !query &&
                    filter === null &&
                    rovingContext.state.activeNode &&
                    rovingContext.state.nodes.length > 0 &&
                    nodeIsForRecentlyViewed(rovingContext.state.activeNode)
                ) {
                    // we only intercept left/right arrows when the field is empty, and they'd do nothing anyway
                    ev.stopPropagation();
                    ev.preventDefault();

                    const nodes = rovingContext.state.nodes.filter(nodeIsForRecentlyViewed);
                    const idx = nodes.indexOf(rovingContext.state.activeNode);
                    node = findNextSiblingElement(
                        nodes,
                        idx + (accessibilityAction === KeyBindingAction.ArrowLeft ? -1 : 1),
                    );
                }
                break;
        }

        if (node) {
            rovingContext.dispatch({
                type: RovingStateActionType.SetFocus,
                payload: { node },
            });
            node?.scrollIntoView({
                block: "nearest",
            });
        }
    };

    const onKeyDown = (ev: React.KeyboardEvent): void => {
        const action = getKeyBindingsManager().getAccessibilityAction(ev);

        switch (action) {
            case KeyBindingAction.Backspace:
                if (!query && filter !== null) {
                    ev.stopPropagation();
                    ev.preventDefault();
                    setFilter(null);
                }
                break;
            case KeyBindingAction.Enter:
                ev.stopPropagation();
                ev.preventDefault();
                rovingContext.state.activeNode?.click();
                break;
        }
    };

    const activeDescendant = rovingContext.state.activeNode?.id;

    const tabs: PillTab<Filter | null>[] = [
        { value: null, label: _t("spotlight_dialog|all") },
        { value: Filter.People, label: filterToLabel(Filter.People) },
        { value: Filter.Messages, label: filterToLabel(Filter.Messages) },
        { value: Filter.PublicRooms, label: filterToLabel(Filter.PublicRooms) },
        ...(supportsSpaceFiltering ? [{ value: Filter.PublicSpaces, label: filterToLabel(Filter.PublicSpaces) }] : []),
    ];

    return (
        <BaseDialog
            className={classNames("mx_SpotlightDialog", { mx_SpotlightDialog_handheld: handheld })}
            onFinished={onFinished}
            // A dialog's fixed width (60vw, at most 704px) is what kept the search to a strip of the screen.
            fixedWidth={false}
            hasCancel={false}
            onKeyDown={onDialogKeyDown}
            screenName="UnifiedSearch"
            aria-label={_t("spotlight_dialog|search_dialog")}
        >
            {/*
             * The search is a screen of its own on a handheld and a panel centred over the app on anything
             * larger (_SpotlightDialog.pcss): the field, the tabs that say what is looked for and, for messages,
             * the chips that narrow them stay at the top while the results scroll under them.
             */}
            <div className="mx_SpotlightDialog_header">
                <div className="mx_SpotlightDialog_column mx_SpotlightDialog_bar">
                    <div className="mx_SpotlightDialog_searchBox mx_textinput">
                        <SearchIcon className="mx_SpotlightDialog_searchIcon" aria-hidden />
                        <input
                            ref={inputRef}
                            autoFocus
                            type="text"
                            autoComplete="off"
                            autoCapitalize="off"
                            autoCorrect="off"
                            spellCheck="false"
                            placeholder={
                                filter === Filter.Messages
                                    ? _t("spotlight_dialog|search_messages")
                                    : _t("action|search")
                            }
                            enterKeyHint="search"
                            value={query}
                            onChange={setQuery}
                            onKeyDown={onKeyDown}
                            aria-owns="mx_SpotlightDialog_content"
                            aria-activedescendant={activeDescendant}
                            aria-label={_t("action|search")}
                            aria-describedby="mx_SpotlightDialog_keyboardPrompt"
                        />
                        {(publicRoomsLoading || peopleLoading || networkPeopleLoading || profileLoading) && (
                            <Spinner size={20} />
                        )}
                        {query && (
                            <AccessibleButton
                                className="mx_SpotlightDialog_clear"
                                tabIndex={-1}
                                onClick={() => {
                                    _setQuery("");
                                    inputRef.current?.focus();
                                }}
                                aria-label={_t("action|clear")}
                            >
                                <CloseIcon />
                            </AccessibleButton>
                        )}
                    </div>
                    {handheld ? (
                        <AccessibleButton className="mx_SpotlightDialog_cancel" onClick={onFinished}>
                            {_t("action|cancel")}
                        </AccessibleButton>
                    ) : (
                        <AccessibleButton
                            className="mx_SpotlightDialog_close"
                            onClick={onFinished}
                            aria-label={_t("action|close")}
                        >
                            <kbd>Esc</kbd>
                            <CloseIcon />
                        </AccessibleButton>
                    )}
                </div>
                <div className="mx_SpotlightDialog_column">
                    <PillTabs
                        className="mx_SpotlightDialog_tabs"
                        tabs={tabs}
                        active={filter}
                        onChange={setFilter}
                        aria-label={_t("spotlight_dialog|filters")}
                    />
                </div>
                {filter === Filter.Messages && (
                    <div className="mx_SpotlightDialog_column">
                        <MessageFilterChips filter={messageFilter} onChange={setMessageFilter} />
                    </div>
                )}
            </div>

            <div
                ref={scrollContainerRef}
                id="mx_SpotlightDialog_content"
                role="listbox"
                aria-activedescendant={activeDescendant}
                aria-describedby="mx_SpotlightDialog_keyboardPrompt"
            >
                <div className="mx_SpotlightDialog_column">{content}</div>
            </div>

            <div id="mx_SpotlightDialog_keyboardPrompt">
                <span>
                    {_t(
                        "spotlight_dialog|keyboard_scroll_hint",
                        {},
                        {
                            arrows: () => (
                                <>
                                    <kbd>↓</kbd>
                                    <kbd>↑</kbd>
                                    {filter === null && !query && <kbd>←</kbd>}
                                    {filter === null && !query && <kbd>→</kbd>}
                                </>
                            ),
                        },
                    )}
                </span>
                <span>{_t("spotlight_dialog|keyboard_open_hint", {}, { enter: () => <kbd>↵</kbd> })}</span>
                <span>{_t("spotlight_dialog|keyboard_close_hint", {}, { esc: () => <kbd>Esc</kbd> })}</span>
            </div>
        </BaseDialog>
    );
};

const RovingSpotlightDialog: React.FC<IProps> = (props) => {
    return <RovingTabIndexProvider>{() => <SpotlightDialog {...props} />}</RovingTabIndexProvider>;
};

export default RovingSpotlightDialog;
