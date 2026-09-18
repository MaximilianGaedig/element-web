/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { EventType, type IContent, type MatrixEvent, MsgType } from "matrix-js-sdk/src/matrix";

/**
 * Media album ("media group") helpers.
 *
 * Bridges (mautrix) mark media events that were sent together on the remote network with
 *   "fi.mau.album": { "id": "<opaque>", "index": 0, "count": 3 }
 * Consecutive events from the same sender that share an album id are rendered as one grid tile.
 *
 * Element-sent media carries no album marker; with the `groupConsecutiveImages` setting enabled,
 * consecutive m.image/m.video events from the same sender sent within {@link NATIVE_GROUP_WINDOW_MS}
 * of each other are grouped the same way.
 */

export const ALBUM_KEY = "fi.mau.album";

/** Maximum gap between two consecutive natively-sent media events of one group. */
export const NATIVE_GROUP_WINDOW_MS = 60 * 1000;

/** Maximum number of cells shown in the grid; the last visible cell carries a "+N" overlay. */
export const MAX_VISIBLE_ALBUM_ITEMS = 6;

/** Upper bound for a bridge-declared `count`, to guard against nonsense values. */
const MAX_DECLARED_COUNT = 100;

/** How long we keep empty placeholder slots for declared-but-not-yet-arrived items. */
export const PLACEHOLDER_GRACE_MS = 5 * 60 * 1000;

export interface AlbumInfo {
    id: string;
    index?: number;
    count?: number;
}

const VISUAL_MSGTYPES: string[] = [MsgType.Image, MsgType.Video];
const ALBUM_MSGTYPES: string[] = [MsgType.Image, MsgType.Video, MsgType.File, MsgType.Audio];

function isRoomMessage(ev: MatrixEvent): boolean {
    return ev.getType() === EventType.RoomMessage && !ev.isRedacted() && !ev.isDecryptionFailure();
}

/**
 * Album grouping is based on the original content: an edit (m.new_content) usually does not repeat
 * the album marker, and editing a caption must not split the album.
 */
function originalContent(ev: MatrixEvent): IContent {
    return ev.getOriginalContent() ?? {};
}

/** Returns the parsed `fi.mau.album` marker of an event, or null if it has none (or a malformed one). */
export function getAlbumInfo(ev: MatrixEvent): AlbumInfo | null {
    if (!isRoomMessage(ev)) return null;
    const content = originalContent(ev);
    if (!ALBUM_MSGTYPES.includes(content.msgtype ?? "")) return null;
    const raw = content[ALBUM_KEY];
    if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !raw.id) return null;
    const info: AlbumInfo = { id: raw.id };
    if (Number.isInteger(raw.index) && raw.index >= 0) info.index = raw.index;
    if (Number.isInteger(raw.count) && raw.count > 0 && raw.count <= MAX_DECLARED_COUNT) info.count = raw.count;
    return info;
}

/** True for plain (non-album) images and videos that can be grouped natively. */
export function isNativeGroupableMedia(ev: MatrixEvent): boolean {
    if (!isRoomMessage(ev)) return false;
    const content = originalContent(ev);
    return VISUAL_MSGTYPES.includes(content.msgtype ?? "") && !getAlbumInfo(ev);
}

/** True if the event is an image or a video (i.e. it gets a grid cell rather than a list row). */
export function isVisualMedia(ev: MatrixEvent): boolean {
    return VISUAL_MSGTYPES.includes(originalContent(ev).msgtype ?? "");
}

export type GroupKind = "album" | "native";

export interface GroupKey {
    kind: GroupKind;
    sender: string;
    /** album id; undefined for native groups */
    albumId?: string;
}

/**
 * Returns the key an event can be grouped under, or null if the event never takes part in a media group.
 * @param nativeGroupingEnabled - value of the `groupConsecutiveImages` setting
 */
export function getGroupKey(ev: MatrixEvent, nativeGroupingEnabled: boolean): GroupKey | null {
    const sender = ev.getSender();
    if (!sender) return null;
    const album = getAlbumInfo(ev);
    if (album) return { kind: "album", sender, albumId: album.id };
    if (nativeGroupingEnabled && isNativeGroupableMedia(ev)) return { kind: "native", sender };
    return null;
}

/**
 * Whether `ev` may join the group started with `key` whose most recent member is `lastMember`.
 */
export function canJoinGroup(
    key: GroupKey,
    lastMember: MatrixEvent,
    ev: MatrixEvent,
    nativeGroupingEnabled: boolean,
): boolean {
    const evKey = getGroupKey(ev, nativeGroupingEnabled);
    if (!evKey || evKey.kind !== key.kind || evKey.sender !== key.sender) return false;
    if (key.kind === "album") return evKey.albumId === key.albumId;
    return Math.abs(ev.getTs() - lastMember.getTs()) <= NATIVE_GROUP_WINDOW_MS;
}

/**
 * Sorts group members for display: by album index where present (stable, falling back to
 * timeline order for items without an index, which go last).
 */
export function sortAlbumItems(events: MatrixEvent[]): MatrixEvent[] {
    return events
        .map((ev, timelinePos) => ({ ev, timelinePos, index: getAlbumInfo(ev)?.index }))
        .sort((a, b) => {
            if (a.index !== undefined && b.index !== undefined && a.index !== b.index) return a.index - b.index;
            if (a.index !== undefined && b.index === undefined) return -1;
            if (a.index === undefined && b.index !== undefined) return 1;
            return a.timelinePos - b.timelinePos;
        })
        .map(({ ev }) => ev);
}

/** Whether a media event carries a caption (MSC2530: `filename` present and different from `body`). */
export function hasMediaCaption(ev: MatrixEvent): boolean {
    const content = ev.getContent();
    return (
        ALBUM_MSGTYPES.includes(content.msgtype ?? "") &&
        typeof content.filename === "string" &&
        typeof content.body === "string" &&
        content.body.trim().length > 0 &&
        content.filename !== content.body
    );
}

/** The items (in display order) whose body is shown as the album caption. */
export function getCaptionEvents(sortedItems: MatrixEvent[]): MatrixEvent[] {
    const seen = new Set<string>();
    return sortedItems.filter((ev) => {
        if (!hasMediaCaption(ev)) return false;
        const body = ev.getContent().body as string;
        if (seen.has(body)) return false;
        seen.add(body);
        return true;
    });
}

/**
 * The highest declared `count` of the members, if every member agrees on being part of one bridged album.
 */
export function getDeclaredCount(items: MatrixEvent[]): number | undefined {
    let count: number | undefined;
    for (const ev of items) {
        const c = getAlbumInfo(ev)?.count;
        if (c !== undefined) count = Math.max(count ?? 0, c);
    }
    return count;
}

/** A slot of the grid: either an arrived item or a placeholder for a declared-but-missing one. */
export type AlbumSlot = { event: MatrixEvent } | { placeholder: true };

/**
 * Lays out the visual items into slots. If the bridge declared a `count` (and it is still recent),
 * missing items get placeholder slots so that late arrivals fill the grid without re-flowing it.
 * Items with unique in-range indices are placed at their index.
 */
export function buildAlbumSlots(
    sortedVisual: MatrixEvent[],
    declaredCount: number | undefined,
    now: number,
): AlbumSlot[] {
    const newestTs = Math.max(...sortedVisual.map((e) => e.getTs()));
    const keepPlaceholders =
        declaredCount !== undefined && declaredCount > sortedVisual.length && now - newestTs < PLACEHOLDER_GRACE_MS;
    if (!keepPlaceholders) return sortedVisual.map((event) => ({ event }));

    const total = declaredCount;
    const indices = sortedVisual.map((e) => getAlbumInfo(e)?.index);
    const placeable = indices.every((i) => i !== undefined && i < total) && new Set(indices).size === indices.length;
    const slots: AlbumSlot[] = Array.from({ length: total }, () => ({ placeholder: true }));
    sortedVisual.forEach((event, i) => {
        slots[placeable ? indices[i]! : i] = { event };
    });
    return slots;
}

export interface AlbumLayout {
    /** number of cells rendered */
    visible: number;
    /** number of slots not rendered, shown as "+N" on the last visible cell (0 = none) */
    overflow: number;
    /** CSS modifier selecting the grid template */
    variant: "n1" | "n2" | "n3" | "n4" | "n5" | "n6";
}

/**
 * Telegram-like layout: 1 alone (only when the album also has non-visual items), 2 side by side, 3 as one large + two small, 4 as 2x2,
 * 5 as 2 + 3, 6+ as 3 + 3 with "+N" on the sixth cell.
 */
export function getAlbumLayout(slotCount: number): AlbumLayout {
    const visible = Math.min(Math.max(slotCount, 1), MAX_VISIBLE_ALBUM_ITEMS);
    const overflow = Math.max(0, slotCount - MAX_VISIBLE_ALBUM_ITEMS);
    const variant = `n${visible}` as AlbumLayout["variant"];
    return { visible, overflow, variant };
}
