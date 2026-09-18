/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type ReactNode } from "react";
import { EventType, type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { uniqBy } from "lodash";

import type MessagePanel from "../MessagePanel";
import { SeparatorKind, type WrappedEvent } from "../MessagePanel";
import { BaseGrouper } from "./BaseGrouper";
import SettingsStore from "../../../settings/SettingsStore";
import { TimelineRenderingType } from "../../../contexts/RoomContext";
import { MediaAlbumContext, type MediaAlbumContextValue } from "../../../contexts/MediaAlbumContext";
import { AggregatedRelations } from "../../../utils/AggregatedRelations";
import { canJoinGroup, getGroupKey, type GroupKey } from "../../../utils/MediaAlbum";
import { type EventTileProps, type GetRelationsForEvent, type IReadReceiptProps } from "../../views/rooms/EventTile";

/**
 * Per-anchor state that must stay referentially stable across renders so that the anchor's EventTile is not
 * re-rendered/re-mounted for nothing, and so that the grid updates in place when items join or leave.
 */
interface AlbumCache {
    items: MatrixEvent[];
    context: MediaAlbumContextValue;
    base?: GetRelationsForEvent;
    relations?: AggregatedRelations;
    getRelationsForEvent?: GetRelationsForEvent;
}

const albumCache = new WeakMap<MatrixEvent, AlbumCache>();

function sameItems(a: MatrixEvent[], b: MatrixEvent[]): boolean {
    return a.length === b.length && a.every((ev, i) => ev === b[i]);
}

function getAlbumCache(anchor: MatrixEvent, items: MatrixEvent[], base?: GetRelationsForEvent): AlbumCache {
    let cache = albumCache.get(anchor);
    if (!cache) {
        cache = { items, context: { anchor, items } };
        albumCache.set(anchor, cache);
    } else if (!sameItems(cache.items, items)) {
        cache.items = items;
        cache.context = { anchor, items };
    }

    if (base) {
        if (!cache.relations) cache.relations = new AggregatedRelations(base);
        cache.relations.setItems(items, base);
        if (cache.base !== base || !cache.getRelationsForEvent) {
            const relations = cache.relations;
            cache.base = base;
            cache.getRelationsForEvent = (eventId, relationType, eventType) => {
                if (eventId === anchor.getId() && relationType === "m.annotation" && eventType === "m.reaction") {
                    return relations.asRelations();
                }
                return base(eventId, relationType, eventType);
            };
        }
    }
    return cache;
}

function nativeGroupingEnabled(): boolean {
    return SettingsStore.getValue("groupConsecutiveImages");
}

function isGroupingTimeline(panel: MessagePanel): boolean {
    const type = panel.context?.timelineRenderingType;
    return type === TimelineRenderingType.Room || type === TimelineRenderingType.Thread;
}

interface PendingEvent {
    wrapped: WrappedEvent;
    /** read markers of hidden events absorbed after this one */
    markers: ReactNode[];
}

/**
 * Groups media events into an album tile.
 *
 * Membership:
 *  - bridged albums: consecutive events from the same sender with the same `fi.mau.album.id`;
 *  - native media (setting `groupConsecutiveImages`): consecutive m.image/m.video from the same sender,
 *    each within 60 s of the previous one, with nothing visible in between.
 *
 * Hidden events never break a group. A visible event from a different sender (or a date/late-event separator)
 * always does. For bridged albums, a visible non-media event from the *same* sender between items does not
 * break the run: it is rendered right after the grid (in its original order relative to other such events).
 * Redacted events from the same sender are dropped if more items follow them (they are former album items),
 * and rendered normally after the grid otherwise.
 *
 * The group is rendered as the EventTile of the first member in timeline order (the "anchor"), wrapped in a
 * {@link MediaAlbumContext} so that its body renders the grid. The anchor stays the same while further items
 * arrive, so the tile is updated in place rather than re-created. A group of one renders as a plain tile.
 */
export class MediaAlbumGrouper extends BaseGrouper {
    public static canStartGroup = function (panel: MessagePanel, { event, shouldShow }: WrappedEvent): boolean {
        if (!shouldShow || !isGroupingTimeline(panel)) return false;
        return getGroupKey(event, nativeGroupingEnabled()) !== null;
    };

    private readonly native: boolean;
    private readonly key: GroupKey;
    private readonly members: WrappedEvent[];
    private readonly pending: PendingEvent[] = [];
    private readonly albumMarkers: ReactNode[] = [];

    public constructor(
        panel: MessagePanel,
        firstEventAndShouldShow: WrappedEvent,
        prevEvent: MatrixEvent | null,
        lastShownEvent: MatrixEvent | undefined,
        nextEvent: WrappedEvent | null,
        nextEventTile?: MatrixEvent | null,
    ) {
        super(panel, firstEventAndShouldShow, prevEvent, lastShownEvent, nextEvent, nextEventTile);
        this.native = nativeGroupingEnabled();
        this.key = getGroupKey(firstEventAndShouldShow.event, this.native)!;
        this.members = [firstEventAndShouldShow];
        this.events = [firstEventAndShouldShow];
        // BaseGrouper computed the read marker for the first event
        if (this.readMarker) this.albumMarkers.push(this.readMarker);
    }

    private get lastMember(): MatrixEvent {
        return this.members[this.members.length - 1].event;
    }

    private get lastShown(): MatrixEvent {
        return this.pending[this.pending.length - 1]?.wrapped.event ?? this.lastMember;
    }

    /** A same-sender event that may sit between album items without breaking the album. */
    private isPassThrough(ev: MatrixEvent): boolean {
        if (ev.getSender() !== this.key.sender) return false;
        if (ev.isRedacted()) {
            return this.key.kind === "album" || ev.getTs() - this.lastMember.getTs() <= 60 * 1000;
        }
        if (this.key.kind !== "album") return false; // native groups: nothing visible in between
        if (ev.isState() || ev.getType() === EventType.RoomCreate) return false;
        if (this.panel.showHiddenEvents && !this.panel.shouldShowEvent(ev, true)) return false;
        // media that could start its own group ends this one
        return getGroupKey(ev, this.native) === null;
    }

    public shouldGroup({ event, shouldShow }: WrappedEvent): boolean {
        if (!shouldShow) return true; // absorb hidden events so they don't split the album
        if (this.panel.wantsSeparator(this.lastShown, event) !== SeparatorKind.None) return false;
        if (canJoinGroup(this.key, this.lastMember, event, this.native)) return true;
        return this.isPassThrough(event);
    }

    public add(wrappedEvent: WrappedEvent): void {
        const { event, shouldShow } = wrappedEvent;
        this.events.push(wrappedEvent);
        const marker = this.panel.readMarkerForEvent(event.getId()!, event === this.lastShownEvent);

        if (shouldShow && canJoinGroup(this.key, this.lastMember, event, this.native)) {
            this.members.push(wrappedEvent);
            // redacted events followed by further items were album items themselves: drop them
            for (let i = this.pending.length - 1; i >= 0; i--) {
                const p = this.pending[i];
                if (!p.wrapped.event.isRedacted()) continue;
                this.pending.splice(i, 1);
                (this.pending[i - 1]?.markers ?? this.albumMarkers).push(...p.markers);
            }
            if (marker) (this.pending[this.pending.length - 1]?.markers ?? this.albumMarkers).push(marker);
            return;
        }

        if (shouldShow) {
            this.pending.push({ wrapped: wrappedEvent, markers: marker ? [marker] : [] });
            return;
        }

        if (marker) (this.pending[this.pending.length - 1]?.markers ?? this.albumMarkers).push(marker);
    }

    private getMergedReadReceipts(): IReadReceiptProps[] | undefined {
        const receipts = this.members.flatMap(
            ({ event }) => this.panel.getReadReceiptsForShownEvent(event.getId()!) ?? [],
        );
        if (!receipts.length) return undefined;
        return uniqBy(
            [...receipts].sort((a, b) => b.ts - a.ts),
            (r) => r.userId,
        );
    }

    public getTiles(): ReactNode[] {
        const panel = this.panel;
        const anchor = this.members[0];
        const items = this.members.map((m) => m.event);
        const cache = getAlbumCache(
            anchor.event,
            items,
            panel.props.showReactions ? panel.props.getRelationsForEvent : undefined,
        );
        const ret: ReactNode[] = [];

        let tiles: ReactNode[];
        if (this.members.length === 1) {
            // A group of one renders exactly like an ungrouped event.
            tiles = panel.getTilesForEvent(
                this.prevEvent,
                anchor,
                anchor.event === this.lastShownEvent,
                false,
                this.nextEvent,
                this.nextEventTile,
                cache.getRelationsForEvent ? { getRelationsForEvent: cache.getRelationsForEvent } : undefined,
            );
        } else {
            const highlighted = panel.props.highlightedEventId;
            const scrollTokens = this.members
                .filter(({ event }) => !event.status)
                .map(({ event }) => event.getId()!)
                .join(",");
            const tileProps: Partial<EventTileProps> = {
                readReceipts: this.getMergedReadReceipts(),
                isSelectedEvent: this.members.some(({ event }) => event.getId() === highlighted),
                lastSuccessful: this.members.some((m) => m.lastSuccessfulWeSent) || undefined,
                scrollTokens: scrollTokens || undefined,
            };
            if (cache.getRelationsForEvent) tileProps.getRelationsForEvent = cache.getRelationsForEvent;
            tiles = panel.getTilesForEvent(
                this.prevEvent,
                anchor,
                this.members.some(({ event }) => event === this.lastShownEvent),
                false,
                this.pending[0]?.wrapped ?? null,
                this.pending[0]?.wrapped.event ?? null,
                tileProps,
            );
        }

        // The provider is always present (even for a single item) so that the tile keeps its place in the React
        // tree, and is updated rather than re-mounted, when the second item arrives.
        const key = "mediaalbum-" + (anchor.event.getTxnId() || anchor.event.getId());
        ret.push(
            <MediaAlbumContext.Provider key={key} value={cache.context}>
                {tiles}
            </MediaAlbumContext.Provider>,
        );
        ret.push(...this.albumMarkers);

        let prev = this.lastMember;
        this.pending.forEach(({ wrapped, markers }, i) => {
            const next = this.pending[i + 1]?.wrapped ?? null;
            ret.push(
                ...panel.getTilesForEvent(
                    prev,
                    wrapped,
                    wrapped.event === this.lastShownEvent,
                    false,
                    next,
                    next?.event ?? null,
                ),
            );
            ret.push(...markers);
            prev = wrapped.event;
        });

        return ret;
    }

    public getNewPrevEvent(): MatrixEvent {
        return this.lastShown;
    }
}
