/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import {
    type AccountDataEvents,
    KnownMembership,
    type MatrixClient,
    type MatrixEvent,
    type Room,
} from "matrix-js-sdk/src/matrix";
import { type ImageInfo } from "matrix-js-sdk/src/types";
import { logger as rootLogger } from "matrix-js-sdk/src/logger";

import { _t } from "../../languageHandler";

const logger = rootLogger.getChild("imagePacks");

/** MSC2545 image packs, as used by the mautrix bridges (e.g. Telegram sticker packs). */
export const ROOM_EMOTES = "im.ponies.room_emotes";
export const USER_EMOTES = "im.ponies.user_emotes";
export const EMOTE_ROOMS = "im.ponies.emote_rooms";
/** Where mautrix bridges put the original sticker's identity, inside `info`. */
export const BRIDGED_STICKER = "fi.mau.bridged_sticker";

type Usage = "sticker" | "emoticon";

interface RawImage {
    url?: unknown;
    body?: unknown;
    info?: unknown;
    usage?: unknown;
    [key: string]: unknown;
}

interface RawPack {
    images?: Record<string, RawImage>;
    pack?: { display_name?: unknown; avatar_url?: unknown; usage?: unknown; attribution?: unknown };
}

export interface PackImage {
    shortcode: string;
    url: string;
    body: string;
    info: ImageInfo & Record<string, unknown>;
    /** Extra top-level keys of the pack image to copy into the sticker event (fi.mau.* metadata). */
    extra: Record<string, unknown>;
}

export interface StickerPack {
    /** Stable id: `room:<roomId>/<stateKey>` or `user`. */
    id: string;
    name: string;
    avatarUrl?: string;
    images: PackImage[];
}

interface EmoteRoomsContent {
    rooms?: Record<string, Record<string, unknown>>;
}

/** Account data of a type the js-sdk doesn't know about. */
function accountData(client: MatrixClient, type: string): MatrixEvent | undefined {
    return client.getAccountData(type as keyof AccountDataEvents);
}

const isMxc = (v: unknown): v is string => typeof v === "string" && v.startsWith("mxc://");

function usages(v: unknown): Usage[] | undefined {
    if (!Array.isArray(v)) return undefined;
    const out = v.filter((u): u is Usage => u === "sticker" || u === "emoticon");
    return out.length ? out : undefined;
}

/** Parses one MSC2545 pack, keeping only images usable as stickers. */
export function parseStickerPack(id: string, content: RawPack, fallbackName: string): StickerPack | undefined {
    if (!content || typeof content !== "object" || !content.images || typeof content.images !== "object") {
        return undefined;
    }
    const packUsage = usages(content.pack?.usage);
    const images: PackImage[] = [];
    for (const [shortcode, raw] of Object.entries(content.images)) {
        if (!raw || typeof raw !== "object" || !isMxc(raw.url)) continue;
        // An image's usage overrides the pack's; with neither, it's both (MSC2545).
        const usage = usages(raw.usage) ?? packUsage;
        if (usage && !usage.includes("sticker")) continue;
        const info = { ...((raw.info && typeof raw.info === "object" ? raw.info : {}) as Record<string, unknown>) };
        const extra: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(raw)) {
            if (key.startsWith("fi.mau.")) extra[key] = value;
        }
        // The bridge looks the original sticker up via info["fi.mau.bridged_sticker"].
        if (extra[BRIDGED_STICKER] && !info[BRIDGED_STICKER]) info[BRIDGED_STICKER] = extra[BRIDGED_STICKER];
        delete extra[BRIDGED_STICKER];
        images.push({
            shortcode,
            url: raw.url,
            body: typeof raw.body === "string" && raw.body ? raw.body : shortcode,
            info: info as PackImage["info"],
            extra,
        });
    }
    if (!images.length) return undefined;
    const name = typeof content.pack?.display_name === "string" ? content.pack.display_name : "";
    return {
        id,
        name: name || fallbackName,
        avatarUrl: isMxc(content.pack?.avatar_url) ? content.pack.avatar_url : undefined,
        images,
    };
}

/** m.sticker content, plus the pack image's fi.mau.* keys. */
export interface PackStickerContent {
    body: string;
    url: string;
    info: ImageInfo;
    [key: string]: unknown;
}

/** Builds the m.sticker content for a pack image, keeping the bridge metadata. */
export function stickerContent(image: PackImage): PackStickerContent {
    return {
        ...image.extra,
        body: image.body,
        url: image.url,
        info: { ...image.info },
    };
}

/** Remote room state fetched for rooms whose state we don't have locally (sliding sync). */
const REMOTE_TTL_MS = 10 * 60_000;
const remoteCache = new Map<string, { at: number; events: Promise<Array<{ stateKey: string; content: RawPack }>> }>();

export function clearImagePackCache(): void {
    remoteCache.clear();
}

async function remotePackEvents(
    client: MatrixClient,
    roomId: string,
): Promise<Array<{ stateKey: string; content: RawPack }>> {
    const cached = remoteCache.get(roomId);
    if (cached && Date.now() - cached.at < REMOTE_TTL_MS) return cached.events;
    const events = client.roomState(roomId).then(
        (state) =>
            state
                .filter((ev) => ev.type === ROOM_EMOTES)
                .map((ev) => ({ stateKey: ev.state_key ?? "", content: ev.content as RawPack })),
        (e) => {
            logger.warn(`Couldn't fetch image packs of ${roomId}`, e);
            remoteCache.delete(roomId);
            return [];
        },
    );
    remoteCache.set(roomId, { at: Date.now(), events });
    return events;
}

/**
 * All pack events of a room, from local state, or (for rooms whose state sliding sync didn't load,
 * e.g. spaces) from GET /state. `onlyStateKeys` restricts to the given state keys.
 */
async function roomPackEvents(
    client: MatrixClient,
    roomId: string,
    onlyStateKeys?: string[],
): Promise<Array<{ stateKey: string; content: RawPack }>> {
    const room = client.getRoom(roomId);
    let events: Array<{ stateKey: string; content: RawPack }> =
        room?.currentState
            .getStateEvents(ROOM_EMOTES)
            .map((ev: MatrixEvent) => ({ stateKey: ev.getStateKey() ?? "", content: ev.getContent() as RawPack })) ??
        [];
    if (!events.length && room?.getMyMembership() !== KnownMembership.Leave) {
        events = await remotePackEvents(client, roomId);
    }
    return onlyStateKeys ? events.filter((e) => onlyStateKeys.includes(e.stateKey)) : events;
}

/**
 * The open room's packs. Its full state can be huge, so when sliding sync didn't load any pack
 * events only the default (empty state key) pack is fetched.
 */
async function currentRoomPackEvents(
    client: MatrixClient,
    room: Room,
): Promise<Array<{ stateKey: string; content: RawPack }>> {
    const local = room.currentState
        .getStateEvents(ROOM_EMOTES)
        .map((ev: MatrixEvent) => ({ stateKey: ev.getStateKey() ?? "", content: ev.getContent() as RawPack }));
    if (local.length) return local;
    const key = `${room.roomId}#default`;
    const cached = remoteCache.get(key);
    if (cached && Date.now() - cached.at < REMOTE_TTL_MS) return cached.events;
    const events = client.getStateEvent(room.roomId, ROOM_EMOTES, "").then(
        (content) => [{ stateKey: "", content: content as RawPack }],
        () => [], // M_NOT_FOUND: no pack
    );
    remoteCache.set(key, { at: Date.now(), events });
    return events;
}

/**
 * Collects the sticker packs available in `room`: the room's own packs, the user's personal pack
 * (im.ponies.user_emotes), the rooms listed in im.ponies.emote_rooms, and packs in the user's
 * joined spaces (which covers the Telegram bridge's personal space). Deduplicated, in that order.
 */
export async function loadStickerPacks(client: MatrixClient, room: Room | undefined): Promise<StickerPack[]> {
    const packs: StickerPack[] = [];
    const seen = new Set<string>();
    const add = (roomId: string, events: Array<{ stateKey: string; content: RawPack }>): void => {
        const roomName = client.getRoom(roomId)?.name ?? roomId;
        for (const { stateKey, content } of events) {
            const id = `room:${roomId}/${stateKey}`;
            if (seen.has(id)) continue;
            seen.add(id);
            const pack = parseStickerPack(id, content, stateKey || roomName);
            if (pack) packs.push(pack);
        }
    };

    const userPack = (): StickerPack | undefined => {
        const ev = accountData(client, USER_EMOTES);
        return ev ? parseStickerPack("user", ev.getContent() as RawPack, _t("beeper|sticker_pack_personal")) : undefined;
    };

    // The current room's own packs first, then the personal pack, then emote rooms and spaces.
    const tasks: Array<[string, Promise<Array<{ stateKey: string; content: RawPack }>>]> = [];
    if (room) tasks.push([room.roomId, currentRoomPackEvents(client, room)]);

    const rooms = (accountData(client, EMOTE_ROOMS)?.getContent() as EmoteRoomsContent | undefined)?.rooms;
    if (rooms && typeof rooms === "object") {
        for (const [roomId, stateKeys] of Object.entries(rooms)) {
            const keys = stateKeys && typeof stateKeys === "object" ? Object.keys(stateKeys) : [];
            tasks.push([roomId, roomPackEvents(client, roomId, keys.length ? keys : undefined)]);
        }
    }

    for (const space of client.getVisibleRooms()) {
        if (!space.isSpaceRoom() || space.getMyMembership() !== KnownMembership.Join) continue;
        tasks.push([space.roomId, roomPackEvents(client, space.roomId)]);
    }

    const results = await Promise.all(tasks.map(([, events]) => events));
    let i = 0;
    if (room) add(tasks[i][0], results[i++]);
    const personal = userPack();
    if (personal) packs.push(personal);
    for (; i < tasks.length; i++) add(tasks[i][0], results[i]);
    return packs;
}
