/*
Copyright 2024 New Vector Ltd.
Copyright 2015-2023 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, type Ref, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
    type ISearchResults,
    type IThreadBundledRelationship,
    type MatrixEvent,
    THREAD_RELATION_TYPE,
} from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";
import { SearchIcon } from "@vector-im/compound-design-tokens/assets/web/icons";
import ChevronUpIcon from "@vector-im/compound-design-tokens/assets/web/icons/chevron-up";
import ChevronDownIcon from "@vector-im/compound-design-tokens/assets/web/icons/chevron-down";
import { IconButton, Text } from "@vector-im/compound-web";

import ScrollPanel from "./ScrollPanel";
import Spinner from "../views/elements/Spinner";
import { _t } from "../../languageHandler";
import { haveRendererForEvent } from "../../events/EventTileFactory";
import SearchResultTile from "../views/rooms/SearchResultTile";
import { searchPagination, SearchScope } from "../../Searching";
import MatrixClientContext from "../../contexts/MatrixClientContext";
import { RoomPermalinkCreator } from "../../utils/permalinks/Permalinks";
import { useScopedRoomContext } from "../../contexts/ScopedRoomContext.tsx";

const DEBUG = false;
let debuglog = function (msg: string): void {};

/* istanbul ignore next */
if (DEBUG) {
    // using bind means that we get to keep useful line numbers in the console
    debuglog = logger.log.bind(console);
}

interface Props {
    term: string;
    scope: SearchScope;
    inProgress: boolean;
    promise: Promise<ISearchResults>;
    className: string;
    onUpdate(this: void, inProgress: boolean, results: ISearchResults | null, error: Error | null): void;
    ref?: Ref<ScrollPanel>;
}

// XXX: todo: merge overlapping results somehow?
// XXX: why doesn't searching on name work?
export const RoomSearchView = ({ term, scope, promise, className, onUpdate, inProgress, ref }: Props): JSX.Element => {
    // Which result the arrows are on. Reset whenever the search itself changes.
    const [at, setAt] = useState(0);
    useEffect(() => {
        setAt(0);
    }, [term, scope]);
    const client = useContext(MatrixClientContext);
    const roomContext = useScopedRoomContext("showHiddenEvents");
    const [highlights, setHighlights] = useState<string[] | null>(null);
    const [results, setResults] = useState<ISearchResults | null>(null);
    const aborted = useRef(false);
    // A map from room ID to permalink creator
    const permalinkCreators = useMemo(() => new Map<string, RoomPermalinkCreator>(), []);
    const innerRef = useRef<ScrollPanel>(null);

    useEffect(() => {
        return () => {
            permalinkCreators.forEach((pc) => pc.stop());
            permalinkCreators.clear();
        };
    }, [permalinkCreators]);

    const handleSearchResult = useCallback(
        (searchPromise: Promise<ISearchResults>): Promise<boolean> => {
            onUpdate(true, null, null);

            return searchPromise.then(
                async (results): Promise<boolean> => {
                    debuglog("search complete");
                    if (aborted.current) {
                        logger.error("Discarding stale search results");
                        return false;
                    }

                    // postgres on synapse returns us precise details of the strings
                    // which actually got matched for highlighting.
                    //
                    // In either case, we want to highlight the literal search term
                    // whether it was used by the search engine or not.

                    let highlights = results.highlights;
                    if (!highlights.includes(term)) {
                        highlights = highlights.concat(term);
                    }

                    // For overlapping highlights,
                    // favour longer (more specific) terms first
                    highlights = highlights.sort(function (a, b) {
                        return b.length - a.length;
                    });

                    for (const result of results.results) {
                        for (const event of result.context.getTimeline()) {
                            const bundledRelationship = event.getServerAggregatedRelation<IThreadBundledRelationship>(
                                THREAD_RELATION_TYPE.name,
                            );
                            if (!bundledRelationship || event.getThread()) continue;
                            const room = client.getRoom(event.getRoomId());
                            const thread = room?.findThreadForEvent(event);
                            if (thread) {
                                event.setThread(thread);
                            } else {
                                room?.createThread(event.getId()!, event, [], true);
                            }
                        }
                    }

                    setHighlights(highlights);
                    setResults({ ...results }); // copy to force a refresh
                    onUpdate(false, results, null);
                    return false;
                },
                (error) => {
                    if (aborted.current) {
                        logger.error("Discarding stale search results");
                        return false;
                    }
                    if (error?.name === "AbortError") {
                        // Opening a result aborts the search, which rejects whatever request is
                        // still in flight. We asked for that, so there is nothing to tell the user
                        // about — and the rejection can reach us before the unmount which would
                        // otherwise have set `aborted`.
                        debuglog("search aborted");
                        return false;
                    }
                    logger.error("Search failed", error);
                    onUpdate(false, null, error);
                    return false;
                },
            );
        },
        [client, term, onUpdate],
    );

    // Mount & unmount effect
    useEffect(() => {
        aborted.current = false;
        void handleSearchResult(promise);
        return () => {
            aborted.current = true;
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // show searching spinner
    if (results === null) {
        return (
            <div
                className="mx_RoomView_messagePanel mx_RoomView_messagePanelSearchSpinner"
                data-testid="messagePanelSearchSpinner"
            >
                <SearchIcon />
            </div>
        );
    }

    const onSearchResultsFillRequest = async (backwards: boolean): Promise<boolean> => {
        if (!backwards) {
            return false;
        }

        if (!results.next_batch) {
            debuglog("no more search results");
            return false;
        }

        debuglog("requesting more search results");
        const searchPromise = searchPagination(client, results);
        return handleSearchResult(searchPromise);
    };

    const ret: JSX.Element[] = [];

    /*
     * The results, in the order they are drawn, so they can be stepped through.
     *
     * Searching a conversation is a way of moving around it: you want the next hit, not a list to
     * read. Other chat apps answer with "3 of 47" and a pair of arrows, and that needs two things -
     * a total, which the server sends (`results.count`), and the id of each result in display
     * order, which is collected here as the list is built. The ids double as ScrollPanel's scroll
     * tokens (SearchResultTile renders `data-scroll-tokens={eventId}`), so stepping is a matter of
     * asking the panel to scroll to one rather than fighting it with scrollIntoView.
     */
    const shown: string[] = [];

    if (inProgress) {
        ret.push(
            <li key="search-spinner">
                <Spinner />
            </li>,
        );
    }

    if (!results.next_batch) {
        if (!results?.results?.length) {
            ret.push(
                <li key="search-top-marker">
                    <h2 className="mx_RoomView_topMarker">{_t("common|no_results")}</h2>
                </li>,
            );
        } else {
            ret.push(
                <li key="search-top-marker">
                    <h2 className="mx_RoomView_topMarker">{_t("no_more_results")}</h2>
                </li>,
            );
        }
    }

    const onRef = (e: ScrollPanel | null): void => {
        if (typeof ref === "function") {
            ref(e);
        } else if (!!ref) {
            ref.current = e;
        }
        innerRef.current = e;
    };

    let lastRoomId: string | undefined;
    let mergedTimeline: MatrixEvent[] = [];
    let ourEventsIndexes: number[] = [];

    for (let i = (results?.results?.length || 0) - 1; i >= 0; i--) {
        const result = results.results[i];

        const mxEv = result.context.getEvent();
        const roomId = mxEv.getRoomId()!;
        const room = client.getRoom(roomId);
        if (!room) {
            // if we do not have the room in js-sdk stores then hide it as we cannot easily show it
            // As per the spec, an all rooms search can create this condition,
            // it happens with Seshat but not Synapse.
            // It will make the result count not match the displayed count.
            logger.log("Hiding search result from an unknown room", roomId);
            continue;
        }

        if (!haveRendererForEvent(mxEv, client, roomContext.showHiddenEvents)) {
            // XXX: can this ever happen? It will make the result count
            // not match the displayed count.
            continue;
        }

        if (scope === SearchScope.All) {
            if (roomId !== lastRoomId) {
                ret.push(
                    <li key={mxEv.getId() + "-room"}>
                        <h2>
                            {_t("common|room")}: {room.name}
                        </h2>
                    </li>,
                );
                lastRoomId = roomId;
            }
        }

        const resultLink = "#/room/" + roomId + "/" + mxEv.getId();
        const shownId = mxEv.getId();
        if (shownId) shown.push(shownId);

        // merging two successive search result if the query is present in both of them
        const currentTimeline = result.context.getTimeline();
        const nextTimeline = i > 0 ? results.results[i - 1].context.getTimeline() : [];

        if (i > 0 && currentTimeline[currentTimeline.length - 1].getId() == nextTimeline[0].getId()) {
            // if this is the first searchResult we merge then add all values of the current searchResult
            if (mergedTimeline.length == 0) {
                for (let j = mergedTimeline.length == 0 ? 0 : 1; j < result.context.getTimeline().length; j++) {
                    mergedTimeline.push(currentTimeline[j]);
                }
                ourEventsIndexes.push(result.context.getOurEventIndex());
            }

            // merge the events of the next searchResult
            for (let j = 1; j < nextTimeline.length; j++) {
                mergedTimeline.push(nextTimeline[j]);
            }

            // add the index of the matching event of the next searchResult
            ourEventsIndexes.push(
                ourEventsIndexes[ourEventsIndexes.length - 1] + results.results[i - 1].context.getOurEventIndex() + 1,
            );

            continue;
        }

        if (mergedTimeline.length == 0) {
            mergedTimeline = result.context.getTimeline();
            ourEventsIndexes = [];
            ourEventsIndexes.push(result.context.getOurEventIndex());
        }

        let permalinkCreator = permalinkCreators.get(roomId);
        if (!permalinkCreator) {
            permalinkCreator = new RoomPermalinkCreator(room);
            permalinkCreator.start();
            // oxlint-disable-next-line react/immutability
            permalinkCreators.set(roomId, permalinkCreator);
        }

        ret.push(
            <SearchResultTile
                key={mxEv.getId()}
                timeline={mergedTimeline}
                ourEventsIndexes={ourEventsIndexes}
                searchHighlights={highlights ?? []}
                resultLink={resultLink}
                permalinkCreator={permalinkCreator}
            />,
        );

        ourEventsIndexes = [];
        mergedTimeline = [];
    }

    /*
     * `results.count` is what the server matched, not what is drawn: results whose room is unknown
     * or unrenderable are skipped above, and paging has usually only fetched the first few. So the
     * position counts within what is on screen while the total speaks for the whole search, and the
     * total is the honest one to show - it is the answer to "is it in here at all".
     */
    const total = results.count ?? shown.length;

    const stepTo = (next: number): void => {
        if (!shown.length) return;
        const wrapped = ((next % shown.length) + shown.length) % shown.length;
        setAt(wrapped);
        innerRef.current?.scrollToToken(shown[wrapped], 0, 0.5);
    };

    return (
        <>
            {total > 0 && (
                <div className="mx_RoomSearchView_count">
                    <Text size="sm" weight="medium">
                        {_t("room|search|position", {
                            position: shown.length ? at + 1 : 0,
                            count: total,
                        })}
                    </Text>
                    <IconButton
                        size="24px"
                        aria-label={_t("room|search|previous")}
                        disabled={shown.length < 2}
                        onClick={() => stepTo(at - 1)}
                    >
                        <ChevronUpIcon />
                    </IconButton>
                    <IconButton
                        size="24px"
                        aria-label={_t("room|search|next")}
                        disabled={shown.length < 2}
                        onClick={() => stepTo(at + 1)}
                    >
                        <ChevronDownIcon />
                    </IconButton>
                </div>
            )}
            <ScrollPanel
                ref={onRef}
                className={"mx_RoomView_searchResultsPanel " + className}
                onFillRequest={onSearchResultsFillRequest}
            >
                <li className="mx_RoomView_scrollheader" />
                {ret}
            </ScrollPanel>
        </>
    );
};
