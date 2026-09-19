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
    MsgType,
    type Room,
} from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import { isAnimatedSticker } from "./bridge/animatedMedia";

/**
 * The shared-media tabs of Telegram Web K's profile (sidebarRight/tabs/sharedMedia.tsx): photos and
 * videos, documents, links, music, voice messages.
 */
export type SharedMediaTab = "media" | "files" | "links" | "music" | "voice";
export const SHARED_MEDIA_TABS: SharedMediaTab[] = ["media", "files", "links", "music", "voice"];

/** tweb appSearchSuper LOAD_COUNT. */
export const SHARED_MEDIA_PAGE = 50;
/** Most /messages requests one "load more" may make while it finds nothing for the tab (links scan text). */
const MAX_REQUESTS_PER_LOAD = 6;

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]}]/gi;

function isVoice(content: Record<string, any>): boolean {
    return !!(content["org.matrix.msc3245.voice"] || content["org.matrix.msc2516.voice"] || content["m.voice"]);
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
    private loadingFor: "url" | "all" | undefined;
    private destroyed = false;

    public constructor(
        private readonly client: MatrixClient,
        private readonly room: Room,
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
    }

    public subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    public state(tab: SharedMediaTab): SharedMediaState {
        const source = this.sourceFor(tab);
        return {
            items: this.items.get(tab)!,
            loading: this.loadingFor === source,
            done: this.doneFor.has(source),
        };
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
        const source = this.sourceFor(tab);
        if (this.loadingFor || this.doneFor.has(source)) return;
        this.loadingFor = source;
        this.emit();
        const before = this.items.get(tab)!.length;
        try {
            for (let i = 0; i < MAX_REQUESTS_PER_LOAD && !this.destroyed; i++) {
                await this.fetchPage(source);
                if (this.doneFor.has(source) || this.items.get(tab)!.length >= before + SHARED_MEDIA_PAGE / 2) break;
                if (this.items.get(tab)!.length > before && i >= 1) break;
            }
        } catch (e) {
            logger.warn("Shared media: failed to load history", e);
        } finally {
            this.loadingFor = undefined;
            if (!this.destroyed) this.emit();
        }
    }

    /** Server-side URL filtering doesn't work on encrypted events, and links live in plain text. */
    private sourceFor(tab: SharedMediaTab): "url" | "all" {
        return tab === "links" || this.client.isRoomEncrypted(this.room.roomId) ? "all" : "url";
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
        this.tokens.set(source, res.end ?? undefined);
        if (!res.end || res.chunk.length === 0) this.doneFor.add(source);
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
        this.items.set(tab, [...list]);
        return true;
    }

    private emit(): void {
        for (const l of this.listeners) l();
    }
}
