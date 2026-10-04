/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Searching what was said, across every chat, for the search view.
 *
 * It is the search the room view's own bar runs (Searching.ts: the local event index when there is one, the
 * server's full-text search otherwise - tuwunel's tantivy index on this fork), only asked of all rooms and
 * answered as a list of hits instead of a timeline. Pages come as the list is scrolled to its end, and the
 * chips on top (messageFilters.ts) are applied to each page as it arrives: when they leave a page nearly
 * empty the next one is fetched at once, so a narrow filter does not look like the end of the results.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type ISearchResults, type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import eventSearch, { searchPagination } from "../../../../Searching";
import DMRoomMap from "../../../../utils/DMRoomMap";
import { isFiltering, matchesMessageFilter, type MessageFilter } from "./messageFilters";

/** Typing pauses this long before a search is sent: every keystroke is a request to the server otherwise. */
const SEARCH_DEBOUNCE_MS = 300;
/** A filter that leaves fewer than this on screen asks for more, up to MAX_AUTO_PAGES times. */
const MIN_SHOWN = 8;
const MAX_AUTO_PAGES = 8;

export interface MessageHit {
    event: MatrixEvent;
    room: Room;
}

export interface MessageSearch {
    hits: MessageHit[];
    highlights: string[];
    /** The first page is on its way. */
    loading: boolean;
    /** A further page is on its way. */
    loadingMore: boolean;
    /** There are more pages to ask for. */
    hasMore: boolean;
    failed: boolean;
    /** How many messages matched in all, as the server or index counted them; absent until it says. */
    count?: number;
    loadMore(this: void): void;
}

function toHits(client: MatrixClient, results: ISearchResults, filter: MessageFilter): MessageHit[] {
    const hits: MessageHit[] = [];
    const seen = new Set<string>();
    for (const result of results.results) {
        const event = result.context.getEvent();
        const id = event.getId();
        const room = client.getRoom(event.getRoomId());
        // A hit in a room this client does not know cannot be opened or named, so it is not offered.
        if (!room || !id || seen.has(id)) continue;
        seen.add(id);
        const content = event.getContent();
        const message = {
            ts: event.getTs(),
            content: content["m.new_content"] ?? content,
            isDirect: !!DMRoomMap.shared().getUserIdForRoomId(room.roomId),
        };
        if (matchesMessageFilter(message, filter)) hits.push({ event, room });
    }
    return hits;
}

export function useMessageSearch(
    client: MatrixClient,
    term: string,
    enabled: boolean,
    filter: MessageFilter,
): MessageSearch {
    const [results, setResults] = useState<ISearchResults | null>(null);
    /* Bumped when a page is added to `results`, which is mutated in place by the SDK. */
    const [version, setVersion] = useState(0);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [failed, setFailed] = useState(false);
    const pages = useRef(0);
    const stale = useRef(0);

    useEffect(() => {
        const trimmed = term.trim();
        const token = ++stale.current;
        pages.current = 0;
        setResults(null);
        setFailed(false);
        setLoadingMore(false);
        if (!enabled || !trimmed) {
            setLoading(false);
            return;
        }
        setLoading(true);
        const abort = new AbortController();
        const timer = setTimeout(() => {
            eventSearch(client, trimmed, undefined, abort.signal).then(
                (found) => {
                    if (token !== stale.current) return;
                    setResults(found);
                    setVersion((v) => v + 1);
                    setLoading(false);
                },
                (error) => {
                    if (token !== stale.current || error?.name === "AbortError") return;
                    logger.warn("Searching messages failed", error);
                    setFailed(true);
                    setLoading(false);
                },
            );
        }, SEARCH_DEBOUNCE_MS);
        return () => {
            clearTimeout(timer);
            abort.abort();
        };
    }, [client, term, enabled]);

    const hits = useMemo(
        () => (results ? toHits(client, results, filter) : []),
        // `version` stands for the pages the SDK appended to `results` itself.
        // oxlint-disable-next-line react-hooks/exhaustive-deps
        [client, results, filter, version],
    );

    const hasMore = !!results?.next_batch;
    const loadMore = useCallback((): void => {
        if (!results?.next_batch || loadingMore) return;
        const token = stale.current;
        setLoadingMore(true);
        pages.current++;
        searchPagination(client, results).then(
            () => {
                if (token !== stale.current) return;
                setVersion((v) => v + 1);
                setLoadingMore(false);
            },
            (error) => {
                if (token !== stale.current) return;
                logger.warn("Loading more messages failed", error);
                setLoadingMore(false);
            },
        );
    }, [client, results, loadingMore]);

    // A filter that hides most of a page must not look like the end: keep asking while there is more.
    useEffect(() => {
        if (!isFiltering(filter) || loading || loadingMore || !hasMore) return;
        if (hits.length < MIN_SHOWN && pages.current < MAX_AUTO_PAGES) loadMore();
    }, [filter, loading, loadingMore, hasMore, hits.length, loadMore]);

    return {
        hits,
        highlights: results?.highlights ?? [],
        loading,
        loadingMore,
        hasMore,
        failed,
        count: results?.count,
        loadMore,
    };
}
