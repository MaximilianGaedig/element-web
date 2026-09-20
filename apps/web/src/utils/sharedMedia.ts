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

/** The URLs in a text message, as tweb's inputMessagesFilterUrl matches them (links in the text). */
export function extractLinks(event: MatrixEvent): string[] {
    if (event.getType() !== EventType.RoomMessage || event.isRedacted()) return [];
    const content = event.getContent();
    if (![MsgType.Text, MsgType.Notice, MsgType.Emote].includes(content.msgtype as MsgType)) return [];
    const texts = [content.body, content.formatted_body].filter((t): t is string => typeof t === "string");
    const found = new Set<string>();
    for (const text of texts) {
        for (const match of text.matchAll(URL_RE)) {
            try {
                found.add(new URL(match[0].replace(/&amp;/g, "&")).toString());
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
    private readonly indexDone = new Set<SharedMediaTab>();
    /** Whether the homeserver has a media index, once asked. */
    private indexSupported?: boolean;

    public constructor(
        private readonly client: MatrixClient,
        public readonly room: Room,
    ) {
        const timeline = room.getLiveTimeline();
        const events = timeline.getEvents();
        for (let i = events.length - 1; i >= 0; i--) this.add(events[i], false);
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
        for (const event of events) added = this.add(event, false) || added;
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

    /** A live (or newly decrypted) event: newest, so it goes first. */
    public addLive(event: MatrixEvent): void {
        if (this.add(event, true)) this.emit();
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

    /** One page of a tab from the server's media index. */
    private async fetchIndexPage(tab: SharedMediaTab): Promise<void> {
        const from = this.indexTokens.get(tab);
        const path = utils.encodeUri("/rooms/$roomId/media", { $roomId: this.room.roomId });
        const res = await this.client.http.authedRequest<{ chunk: IRoomEvent[]; end?: string }>(
            Method.Get,
            path,
            { kind: tab, limit: String(SHARED_MEDIA_PAGE), ...(from ? { from } : {}) },
            undefined,
            { prefix: MEDIA_INDEX_PREFIX },
        );
        if (this.destroyed) return;
        const mapper = this.client.getEventMapper();
        const events = res.chunk.map((raw) => mapper(raw));
        for (const ev of events) this.add(ev, false);
        historyIndexer.add(events); // keep them, so the tab fills even without the server
        this.indexTokens.set(tab, res.end);
        if (!res.end || res.chunk.length === 0) this.indexDone.add(tab);
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
        for (const ev of events) this.add(ev, false);
        historyIndexer.add(events); // keep them, so the next visit doesn't scan again
        this.tokens.set(source, res.end ?? undefined);
        if (!res.end || res.chunk.length === 0) this.doneFor.add(source);
        void this.saveProgress();
        this.emit();
    }

    private add(event: MatrixEvent, newest: boolean): boolean {
        const id = event.getId();
        if (!id || this.seen.has(id)) return false;
        const tab = sharedMediaTab(event);
        if (!tab) return false;
        this.seen.add(id);
        const list = this.items.get(tab)!;
        if (newest) {
            list.unshift(event);
        } else {
            // Pages arrive newest→oldest, but live-timeline seeding may overlap; keep newest first.
            const ts = event.getTs();
            let i = list.length;
            while (i > 0 && list[i - 1].getTs() < ts) i--;
            list.splice(i, 0, event);
        }
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
