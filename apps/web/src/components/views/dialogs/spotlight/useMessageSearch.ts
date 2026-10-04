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
 *
 * With nothing typed and a kind chosen (Media, Links, Files, Music, Voice) there are no words to match, so
 * the list is every message of that kind in every chat, newest first, as Telegram's global search shows
 * it. That comes from the homeserver's media index (tuwunel `GET /im.mxg.media_index/media`), which keeps
 * one list per kind across all the rooms a user is in; a server without it lists nothing, and encrypted
 * rooms are not in it because the server cannot read them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    type IRoomEvent,
    type ISearchResults,
    type MatrixClient,
    type MatrixEvent,
    Method,
    type Room,
} from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import eventSearch, { searchPagination } from "../../../../Searching";
import DMRoomMap from "../../../../utils/DMRoomMap";
import { isFiltering, matchesMessageFilter, type MessageFilter, type MessageKind } from "./messageFilters";

/** Typing pauses this long before a search is sent: every keystroke is a request to the server otherwise. */
const SEARCH_DEBOUNCE_MS = 300;
/** A filter that leaves fewer than this on screen asks for more, up to MAX_AUTO_PAGES times. */
const MIN_SHOWN = 8;
const MAX_AUTO_PAGES = 8;

/** The homeserver's index of each kind of message across all of a user's rooms (tuwunel `media_all.rs`). */
const MEDIA_INDEX_FEATURE = "im.mxg.media_index";
const MEDIA_INDEX_PREFIX = "/_matrix/client/unstable/im.mxg.media_index";
const BROWSE_PAGE = 50;

/** What has been listed of one kind with nothing typed, newest first, and where the next page starts. */
interface Browsed {
    hits: { event: MatrixEvent; roomId: string }[];
    end?: string;
}

/** One page of every message of a kind, from every room at once. */
async function browsePage(client: MatrixClient, kind: MessageKind, from?: string): Promise<Browsed> {
    const res = await client.http.authedRequest<{ chunk: IRoomEvent[]; rooms: string[]; end?: string }>(
        Method.Get,
        "/media",
        { kind, limit: String(BROWSE_PAGE), ...(from ? { from } : {}) },
        undefined,
        { prefix: MEDIA_INDEX_PREFIX },
    );
    const mapper = client.getEventMapper();
    const hits: Browsed["hits"] = [];
    res.chunk.forEach((raw, i) => {
        const roomId = res.rooms[i];
        if (roomId) hits.push({ event: mapper({ ...raw, room_id: roomId }), roomId });
    });
    return { hits, end: res.end };
}

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
    /** Listing every message of the chosen kind, with nothing typed: the server can and was asked to. */
    browsing: boolean;
    loadMore(this: void): void;
}

function toHits(client: MatrixClient, events: MatrixEvent[], filter: MessageFilter): MessageHit[] {
    const hits: MessageHit[] = [];
    const seen = new Set<string>();
    for (const event of events) {
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
    const [browsed, setBrowsed] = useState<Browsed | null>(null);
    const pages = useRef(0);
    const stale = useRef(0);
    const trimmed = term.trim();
    // The kind to list everything of, when nothing is typed; with words typed the kind only narrows.
    const browseKind = enabled && !trimmed ? filter.kind : "any";

    useEffect(() => {
        const token = ++stale.current;
        pages.current = 0;
        setResults(null);
        setBrowsed(null);
        setFailed(false);
        setLoadingMore(false);
        if (!enabled || (!trimmed && browseKind === "any")) {
            setLoading(false);
            return;
        }
        if (!trimmed) {
            setLoading(true);
            void (async (): Promise<void> => {
                try {
                    if (!(await client.doesServerSupportUnstableFeature(MEDIA_INDEX_FEATURE))) {
                        if (token === stale.current) setLoading(false);
                        return;
                    }
                    const page = await browsePage(client, browseKind);
                    if (token !== stale.current) return;
                    setBrowsed(page);
                    setLoading(false);
                } catch (error) {
                    if (token !== stale.current) return;
                    logger.warn("Listing messages by kind failed", error);
                    setBrowsed({ hits: [] });
                    setFailed(true);
                    setLoading(false);
                }
            })();
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
    }, [client, trimmed, enabled, browseKind]);

    const hits = useMemo(
        () => {
            if (browsed) {
                // The server already chose the kind, by rules of its own (a link in a caption, say); only
                // where and when are left to narrow by.
                return toHits(
                    client,
                    browsed.hits.map((hit) => hit.event),
                    { ...filter, kind: "any" },
                );
            }
            return results
                ? toHits(
                      client,
                      results.results.map((result) => result.context.getEvent()),
                      filter,
                  )
                : [];
        },
        // `version` stands for the pages the SDK appended to `results` itself.
        // oxlint-disable-next-line react-hooks/exhaustive-deps
        [client, results, browsed, filter, version],
    );

    const hasMore = browsed ? !!browsed.end : !!results?.next_batch;
    const loadMore = useCallback((): void => {
        if (loadingMore) return;
        if (browsed) {
            if (!browsed.end || browseKind === "any") return;
            const token = stale.current;
            setLoadingMore(true);
            pages.current++;
            browsePage(client, browseKind, browsed.end).then(
                (page) => {
                    if (token !== stale.current) return;
                    setBrowsed({ hits: [...browsed.hits, ...page.hits], end: page.end });
                    setLoadingMore(false);
                },
                (error) => {
                    if (token !== stale.current) return;
                    logger.warn("Listing more messages by kind failed", error);
                    setLoadingMore(false);
                },
            );
            return;
        }
        if (!results?.next_batch) return;
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
    }, [client, results, browsed, browseKind, loadingMore]);

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
        browsing: !!browsed,
        loadMore,
    };
}
