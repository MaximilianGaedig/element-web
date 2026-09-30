/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import {
    Direction,
    EventType,
    Filter,
    type IRoomEvent,
    type MatrixClient,
    type MatrixEvent,
    Method,
    MsgType,
    type Room,
} from "matrix-js-sdk/src/matrix";
import * as utils from "matrix-js-sdk/src/utils";
import { logger } from "matrix-js-sdk/src/logger";

import { isAnimatedSticker } from "./bridge/animatedMedia";
import { parsePermalink } from "./permalinks/Permalinks";
import SdkConfig from "../SdkConfig";
import { stripPlainReply } from "./Reply";
import { getPerMessageProfile } from "./bridge/perMessageProfile";
import { getRoomHistoryState, mediaPage, setRoomHistoryState } from "./history/db";
import { historyIndexer } from "./history/indexer";

/**
 * The shared-media tabs of Telegram Web K's profile (sidebarRight/tabs/sharedMedia.tsx): photos and
 * videos, documents, links, music, voice messages.
 */
export type SharedMediaTab = "media" | "files" | "links" | "music" | "voice";
export const SHARED_MEDIA_TABS: SharedMediaTab[] = ["media", "files", "links", "music", "voice"];

/** The homeserver's media index (tuwunel: rooms::media_index), which makes a tab one request. */
const MEDIA_INDEX_FEATURE = "im.mxg.media_index";
const MEDIA_INDEX_PREFIX = "/_matrix/client/unstable/im.mxg.media_index";

/**
 * One month of a room's media of one kind, as the server's index reports it
 * (tuwunel `api::client::media_index::MonthCount`).
 */
export interface MonthCount {
    /** `YYYY-MM`, UTC. */
    month: string;
    count: number;
    /** Pass to {@link SharedMediaLoader.seekTo} to open the list at this month. */
    before_ts: number;
}

/** tweb appSearchSuper LOAD_COUNT. */
export const SHARED_MEDIA_PAGE = 50;
/** Most requests one "load more" may make while it finds nothing for the tab (links scan text). */
const MAX_REQUESTS_PER_LOAD = 6;

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]}]/gi;

/**
 * A voice message rather than a piece of music. MSC3245 marks it with an empty object, so the key
 * being there is the flag; `m.voice` is what some bridges send instead.
 */
export function isVoice(content: Record<string, any>): boolean {
    return ["org.matrix.msc3245.voice", "org.matrix.msc2516.voice", "m.voice"].some((key) => key in content);
}

/**
 * A link to a person or a room: what a mention pill is, and what bridges put in a "Forwarded from"
 * header. tweb keeps those out of the Links tab (a mention is its own entity, and the forward header
 * isn't part of the text); a link to a message is still a link somebody shared.
 */
function isPillLink(url: string): boolean {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return false;
    }
    if (parsed.hostname !== "matrix.to") {
        // The app's own permalinks (config permalink_prefix) come out of its own link builder, so they parse.
        const prefix = SdkConfig.get("permalink_prefix");
        if (!prefix || !url.startsWith(prefix)) return false;
        const parts = parsePermalink(url);
        return !!parts && !parts.eventId && !!(parts.userId || parts.roomIdOrAlias);
    }
    // matrix.to/#/<entity>[/<event>]: read the entity's sigil here, since parsePermalink logs an error for
    // every kind of link it doesn't know (groups, bare "#/", other clients' extensions).
    let path: string;
    try {
        path = decodeURIComponent(parsed.hash.replace(/^#\/?/, "").split("?")[0]);
    } catch {
        return false;
    }
    const [entity = "", event = ""] = path.split("/");
    if (entity.startsWith("@")) return true;
    return (entity.startsWith("!") || entity.startsWith("#")) && !event.startsWith("$");
}

/** The URLs in a text message, as tweb's inputMessagesFilterUrl matches them (links in the text). */
export function extractLinks(event: MatrixEvent): string[] {
    if (event.getType() !== EventType.RoomMessage || event.isRedacted()) return [];
    const content = event.getContent();
    if (![MsgType.Text, MsgType.Notice, MsgType.Emote].includes(content.msgtype as MsgType)) return [];
    // A reply's fallback quotes the message it replies to, links and all; those are that message's.
    const texts = [
        typeof content.body === "string" ? stripPlainReply(content.body) : undefined,
        typeof content.formatted_body === "string"
            ? content.formatted_body.replace(/<mx-reply>[\s\S]*?<\/mx-reply>/gi, "")
            : undefined,
    ].filter((t): t is string => t !== undefined);
    const found = new Set<string>();
    for (const text of texts) {
        for (const match of text.matchAll(URL_RE)) {
            try {
                const url = new URL(match[0].replace(/&amp;/g, "&")).toString();
                if (!isPillLink(url)) found.add(url);
            } catch {
                // not a URL after all
            }
        }
    }
    return [...found];
}

/** Which tab `event` belongs in, or undefined for anything that isn't shared media. */
export function sharedMediaTab(event: MatrixEvent): SharedMediaTab | undefined {
    if (event.isRedacted() || event.isDecryptionFailure()) return undefined;
    if (event.getType() !== EventType.RoomMessage) return undefined;
    if (event.isRelation("m.replace")) return undefined;
    const content = event.getContent();
    switch (content.msgtype) {
        case MsgType.Image:
            return "media";
        case MsgType.Video:
            return isAnimatedSticker(event) ? undefined : "media";
        case MsgType.File:
            return "files";
        case MsgType.Audio:
            return isVoice(content) ? "voice" : "music";
        default:
            return extractLinks(event).length ? "links" : undefined;
    }
}

export interface SharedMediaState {
    items: MatrixEvent[];
    loading: boolean;
    /** No older history left to scan. */
    done: boolean;
}

/**
 * How many of each tab the room holds in all, from the homeserver's counts (`im.mxg.room_stats`), so a
 * tab can say "45 photos, 6 videos" of the whole history rather than of what happens to be loaded.
 * A tab with no count of its own (links: the server counts message kinds, not links) is left out.
 */
export function tabCountsFromStats(byKind: Record<string, number>): Partial<Record<SharedMediaTab, number>> {
    const counts: Partial<Record<SharedMediaTab, number>> = {};
    // Stickers are counted apart and the tabs don't list them, so they are left out of "media".
    const media = (byKind.image ?? 0) + (byKind.video ?? 0);
    if (media) counts.media = media;
    if (byKind.file) counts.files = byKind.file;
    if (byKind.audio) counts.music = byKind.audio;
    if (byKind.voice) counts.voice = byKind.voice;
    // Links are text the server happens to have found a link in, so they only have a count of their
    // own where the server counts them apart (tuwunel rooms::room_stats Class::Link). An older one
    // says nothing here and the tab goes on counting what it has loaded, as it always did.
    if (byKind.link) counts.links = byKind.link;
    return counts;
}

/** Who sent it, as the lists label it: a bridge's per-message profile first, then the room member. */
export function mediaSenderName(event: MatrixEvent, room?: Room): string {
    const sender = event.getSender() ?? "";
    return getPerMessageProfile(event)?.displayname ?? room?.getMember(sender)?.name ?? event.sender?.name ?? sender;
}

type Listener = () => void;

/**
 * Collects a room's shared media, newest first: what the client already has in the live timeline shows
 * straight away, then older history is fetched with /messages on demand. Media/files/audio ask the
 * server for events with a URL only (contains_url); links and encrypted rooms have to scan all
 * messages. Live events are added as they arrive.
 */
export class SharedMediaLoader {
    private readonly seen = new Set<string>();
    private readonly items = new Map<SharedMediaTab, MatrixEvent[]>(SHARED_MEDIA_TABS.map((t) => [t, []]));
    private readonly listeners = new Set<Listener>();
    private readonly tokens = new Map<"url" | "all", string | undefined>();
    private readonly doneFor = new Set<"url" | "all">();
    /** Which tabs are waiting on a request: a tab of its own in the index, a shared scan otherwise. */
    private readonly loadingTabs = new Set<SharedMediaTab>();
    /** One history scan per source, however many tabs are waiting on it. */
    private readonly scanning = new Map<"url" | "all", Promise<void>>();
    /** Tabs whose list changed since the last {@link emit}. */
    private readonly dirty = new Set<SharedMediaTab>();
    private destroyed = false;
    /** What earlier visits already found and how far they scanned; read before touching the network. */
    private restored?: Promise<void>;
    /** Where each tab got to in the server's media index, and which tabs it has exhausted. */
    private readonly indexTokens = new Map<SharedMediaTab, string | undefined>();
    /** What the server said each tab holds per month, once asked. */
    private readonly months = new Map<SharedMediaTab, MonthCount[]>();
    private readonly indexDone = new Set<SharedMediaTab>();
    /** Whether the homeserver has a media index, once asked. */
    private indexSupported?: boolean;

    public constructor(
        private readonly client: MatrixClient,
        public readonly room: Room,
    ) {
        const timeline = room.getLiveTimeline();
        const events = timeline.getEvents();
        for (let i = events.length - 1; i >= 0; i--) this.add(events[i]);
        // The live timeline's backward token, if the client has one. With sliding sync it often has none
        // yet; that doesn't mean the room has no history, so paging then starts from the latest event
        // (/messages without `from`) and the seen-set drops the overlap. A source is only done once the
        // server returns no further token.
        const back = timeline.getPaginationToken(Direction.Backward) ?? undefined;
        this.tokens.set("url", back);
        this.tokens.set("all", back);
        this.restored = this.restore();
    }

    /**
     * Shows what earlier visits found, from the local message database, and carries the scan on from
     * where it stopped. Without this every visit pages back through the room's history again, which is
     * what made the tabs take seconds to fill (and for links and encrypted rooms the server cannot
     * filter at all, so it is a full scan).
     */
    private async restore(): Promise<void> {
        const stored = await Promise.all(
            SHARED_MEDIA_TABS.map((tab) => mediaPage(this.room.roomId, tab, SHARED_MEDIA_PAGE)),
        );
        if (this.destroyed) return;
        const mapper = this.client.getEventMapper();
        const events = stored.flat().map(({ raw }) => mapper(raw));
        await Promise.all(events.filter((ev) => ev.isEncrypted()).map((ev) => this.client.decryptEventIfNeeded(ev)));
        if (this.destroyed) return;
        let added = false;
        for (const event of events) added = this.add(event) || added;
        const state = await getRoomHistoryState(this.room.roomId);
        for (const source of ["url", "all"] as const) {
            if (state?.mediaTokens?.[source]) this.tokens.set(source, state.mediaTokens[source]);
            if (state?.mediaDone?.includes(source)) this.doneFor.add(source);
        }
        if (added) this.emit();
    }

    /** Remembers where the scan got to, so the next visit continues instead of starting over. */
    private async saveProgress(): Promise<void> {
        const state = (await getRoomHistoryState(this.room.roomId)) ?? {
            roomId: this.room.roomId,
            updatedAt: Date.now(),
        };
        await setRoomHistoryState({
            ...state,
            mediaTokens: { url: this.tokens.get("url"), all: this.tokens.get("all") },
            mediaDone: [...this.doneFor],
            updatedAt: Date.now(),
        });
    }

    public subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    public state(tab: SharedMediaTab): SharedMediaState {
        return {
            items: this.items.get(tab)!,
            loading: this.loadingTabs.has(tab),
            done: this.isDone(tab),
        };
    }

    /**
     * Whether this tab has nothing left to fetch. The media index answers each tab on its own, so one
     * tab running out says nothing about the others; only a history scan, which every tab of a source
     * shares, is done for all of them at once.
     */
    private isDone(tab: SharedMediaTab): boolean {
        if (this.indexDone.has(tab)) return true;
        return this.indexSupported === false && this.doneFor.has(this.sourceFor(tab));
    }

    /** An event from outside a page: a live one, or one that has just been decrypted. */
    public addLive(event: MatrixEvent): void {
        if (this.add(event)) this.emit();
    }

    public remove(eventId: string): void {
        let changed = false;
        for (const [tab, list] of this.items) {
            const next = list.filter((e) => e.getId() !== eventId);
            if (next.length !== list.length) {
                this.items.set(tab, next);
                changed = true;
            }
        }
        if (changed) this.emit();
    }

    /**
     * Stops the loader when its component goes away. React (StrictMode in development) may run the
     * owning effect again for the same loader, so {@link attach} brings it back rather than a destroyed
     * loader silently never loading again (the "infinitely loading" media tab).
     */
    public destroy(): void {
        this.destroyed = true;
        this.listeners.clear();
    }

    /** Undoes {@link destroy} when the owning effect runs again with this loader. */
    public attach(): void {
        this.destroyed = false;
    }

    /** Fetches older history until `tab` gained items (or history ran out). */
    public async loadMore(tab: SharedMediaTab): Promise<void> {
        if (this.loadingTabs.has(tab) || this.isDone(tab)) return;
        this.loadingTabs.add(tab);
        this.emit();
        const before = this.items.get(tab)!.length;
        const enough = (): boolean => this.items.get(tab)!.length >= before + SHARED_MEDIA_PAGE / 2;
        try {
            await this.restored; // what earlier visits found comes first, and sets where to carry on
            const index = await this.hasServerIndex();
            // Every request is capped: a kind whose entries are all filtered out here (the index counts
            // stickers as media, the tabs don't) would otherwise walk the whole room in one go.
            for (let i = 0; i < MAX_REQUESTS_PER_LOAD && !this.destroyed && !this.isDone(tab); i++) {
                if (index) {
                    await this.fetchIndexPage(tab);
                    if (enough()) break;
                    continue;
                }
                await this.scanPage(this.sourceFor(tab));
                if (enough()) break;
                if (this.items.get(tab)!.length > before && i >= 1) break;
            }
        } catch (e) {
            logger.warn("Shared media: failed to load history", e);
        } finally {
            this.loadingTabs.delete(tab);
            if (!this.destroyed) this.emit();
        }
    }

    /**
     * Whether the homeserver keeps a media index (MEDIA_INDEX_FEATURE): then a tab is one request,
     * however old the room's history is. It cannot index encrypted rooms, which are read here instead.
     */
    private async hasServerIndex(): Promise<boolean> {
        if (this.indexSupported === undefined) {
            try {
                this.indexSupported =
                    !this.client.isRoomEncrypted(this.room.roomId) &&
                    (await this.client.doesServerSupportUnstableFeature(MEDIA_INDEX_FEATURE));
            } catch {
                this.indexSupported = false;
            }
        }
        return this.indexSupported;
    }

    /**
     * How many items each month holds, newest month first, straight from the server's index.
     *
     * Asked for once per tab and kept: it is what sizes and labels the scrubber, and a scrubber
     * whose length changes while it is being dragged is worse than no scrubber. The server reads
     * this from the index alone, so it costs no event fetches however long the history is.
     *
     * Empty where the homeserver keeps no index, which is also the encrypted case - there the
     * scrubber can only describe what has been loaded, which is what it did before this existed.
     */
    public async monthCounts(tab: SharedMediaTab): Promise<MonthCount[]> {
        const known = this.months.get(tab);
        if (known) return known;
        if (!(await this.hasServerIndex())) return [];
        try {
            const path = utils.encodeUri("/rooms/$roomId/media", { $roomId: this.room.roomId });
            const res = await this.client.http.authedRequest<{ months?: MonthCount[] }>(
                Method.Get,
                path,
                { kind: tab, months: "true" },
                undefined,
                { prefix: MEDIA_INDEX_PREFIX },
            );
            const months = res.months ?? [];
            if (!this.destroyed) this.months.set(tab, months);
            return months;
        } catch (e) {
            logger.warn("Shared media: failed to read the month counts", e);
            return [];
        }
    }

    /**
     * Loads the stretch around `ts` directly, rather than paging back to it from the newest item.
     *
     * This is the whole point of the index carrying each item's time: seeking a year back costs one
     * request instead of a page for every month in between. What comes back is merged by timestamp
     * like anything else ({@link add}), so a list built by seeking and a list built by paging are
     * the same list - the reader can scrub to March, scroll up into February, and the two meet.
     *
     * Paging is left exactly where it was: `from` continues to walk back from the newest item, so a
     * seek adds to the list without deciding where "the end" is.
     */
    public async seekTo(tab: SharedMediaTab, ts: number): Promise<void> {
        if (this.loadingTabs.has(tab) || !(await this.hasServerIndex())) return;
        this.loadingTabs.add(tab);
        this.emit();
        try {
            await this.fetchIndexPage(tab, ts);
        } catch (e) {
            logger.warn("Shared media: failed to seek to a date", e);
        } finally {
            this.loadingTabs.delete(tab);
            if (!this.destroyed) this.emit();
        }
    }

    /**
     * One page of a tab from the server's media index.
     *
     * With `beforeTs` it starts at the newest item sent at or before that time and does not touch
     * the tab's paging token: a seek is a window onto the middle of the history, not a step through
     * it, and letting it move `from` would make the next "load more" continue from wherever the
     * reader happened to scrub to.
     */
    private async fetchIndexPage(tab: SharedMediaTab, beforeTs?: number): Promise<void> {
        const from = this.indexTokens.get(tab);
        const path = utils.encodeUri("/rooms/$roomId/media", { $roomId: this.room.roomId });
        const res = await this.client.http.authedRequest<{ chunk: IRoomEvent[]; end?: string }>(
            Method.Get,
            path,
            {
                kind: tab,
                limit: String(SHARED_MEDIA_PAGE),
                ...(beforeTs !== undefined ? { before_ts: String(beforeTs) } : from ? { from } : {}),
            },
            undefined,
            { prefix: MEDIA_INDEX_PREFIX },
        );
        if (this.destroyed) return;
        const mapper = this.client.getEventMapper();
        const events = res.chunk.map((raw) => mapper(raw));
        for (const ev of events) this.add(ev);
        historyIndexer.add(events); // keep them, so the tab fills even without the server
        // A seek says nothing about how far the paging has got, so it leaves both alone. Marking a
        // tab done because a seek into the middle of the history came back short would stop the
        // list loading anything more.
        if (beforeTs === undefined) {
            this.indexTokens.set(tab, res.end);
            if (!res.end || res.chunk.length === 0) this.indexDone.add(tab);
        }
        this.emit(); // each page shows as it arrives, rather than only when the load stops
    }

    /** Server-side URL filtering doesn't work on encrypted events, and links live in plain text. */
    private sourceFor(tab: SharedMediaTab): "url" | "all" {
        return tab === "links" || this.client.isRoomEncrypted(this.room.roomId) ? "all" : "url";
    }

    /** A scan page, shared: the tabs of one source read the same history, so they fetch it once. */
    private scanPage(source: "url" | "all"): Promise<void> {
        const pending = this.scanning.get(source);
        if (pending) return pending;
        const page = this.fetchPage(source).finally(() => this.scanning.delete(source));
        this.scanning.set(source, page);
        return page;
    }

    private async fetchPage(source: "url" | "all"): Promise<void> {
        const from = this.tokens.get(source);
        const filter = new Filter(this.client.getSafeUserId());
        filter.setDefinition({
            room: {
                timeline:
                    source === "url"
                        ? { types: [EventType.RoomMessage], contains_url: true }
                        : { types: [EventType.RoomMessage, EventType.RoomMessageEncrypted] },
            },
        });
        const res = await this.client.createMessagesRequest(
            this.room.roomId,
            from ?? null,
            SHARED_MEDIA_PAGE,
            Direction.Backward,
            filter,
        );
        if (this.destroyed) return;
        const mapper = this.client.getEventMapper();
        const events = res.chunk.map((raw: IRoomEvent) => mapper(raw));
        await Promise.all(events.filter((ev) => ev.isEncrypted()).map((ev) => this.client.decryptEventIfNeeded(ev)));
        for (const ev of events) this.add(ev);
        historyIndexer.add(events); // keep them, so the next visit doesn't scan again
        this.tokens.set(source, res.end ?? undefined);
        if (!res.end || res.chunk.length === 0) this.doneFor.add(source);
        void this.saveProgress();
        this.emit();
    }

    /**
     * Puts an event in its tab, newest first.
     *
     * Where it goes is decided by its timestamp and never by when it turned up, because "it just
     * arrived" does not mean "it is the newest". A page of an encrypted room is decrypted all at
     * once, and every one of those decryptions reaches the loader through
     * `MatrixEventEvent.Decrypted` - so treating an arrival as the newest item put the whole page at
     * the top of the list in whatever order the crypto worker happened to finish in.
     */
    private add(event: MatrixEvent): boolean {
        const id = event.getId();
        if (!id || this.seen.has(id)) return false;
        const tab = sharedMediaTab(event);
        if (!tab) return false;
        this.seen.add(id);
        const list = this.items.get(tab)!;
        // Pages arrive newest→oldest, so this stops at once for them; only an event that turns up out
        // of order walks any distance.
        const ts = event.getTs();
        let i = list.length;
        while (i > 0 && list[i - 1].getTs() < ts) i--;
        list.splice(i, 0, event);
        this.dirty.add(tab);
        return true;
    }

    /** A page's events are added to the list in place; the copy React needs is made once, here. */
    private emit(): void {
        for (const tab of this.dirty) this.items.set(tab, [...this.items.get(tab)!]);
        this.dirty.clear();
        for (const l of this.listeners) l();
    }
}
