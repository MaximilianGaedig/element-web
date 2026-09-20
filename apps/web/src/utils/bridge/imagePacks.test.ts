/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { type MatrixClient, MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";

import { clearImagePackCache, loadStickerPacks, parseStickerPack, stickerContent } from "./imagePacks";

const BRIDGED = {
    network: "telegram",
    id: "5170233102089322756",
    emoji: "😀",
    pack_url: "https://t.me/addstickers/HotCherry",
};

/** What mautrix-telegram's DownloadImagePack writes (imagepack.go). */
const TELEGRAM_PACK = {
    "images": {
        HotCherry_grinning: {
            url: "mxc://example.org/cherry1",
            body: "😀",
            info: { "w": 512, "h": 512, "mimetype": "video/webm", "size": 1234, "fi.mau.bridged_sticker": BRIDGED },
        },
        HotCherry_heart: {
            url: "mxc://example.org/cherry2",
            body: "❤️",
            info: { w: 512, h: 512, mimetype: "image/webp" },
        },
    },
    "pack": {
        "display_name": "Hot Cherry",
        "usage": ["sticker"],
        "attribution": "Imported from https://t.me/addstickers/HotCherry",
        "fi.mau.bridged_pack": { network: "telegram", url: "https://t.me/addstickers/HotCherry" },
    },
    "fi.mau.telegram.stickerpack": { id: "1", short_name: "HotCherry", emoji_pack: false },
};

const EMOJI_PACK = {
    images: { blob: { url: "mxc://example.org/blob", body: "blob" } },
    pack: { display_name: "Emoji", usage: ["emoticon"] },
};

function fakeRoom(roomId: string, packs: Record<string, object>, opts: { space?: boolean; name?: string } = {}): Room {
    const events = Object.entries(packs).map(
        ([stateKey, content]) =>
            new MatrixEvent({ type: "im.ponies.room_emotes", state_key: stateKey, content, room_id: roomId }),
    );
    return {
        roomId,
        name: opts.name ?? roomId,
        isSpaceRoom: () => !!opts.space,
        getMyMembership: () => "join",
        currentState: { getStateEvents: (type: string) => (type === "im.ponies.room_emotes" ? events : []) },
    } as unknown as Room;
}

function fakeClient(
    rooms: Room[],
    accountData: Record<string, object> = {},
): MatrixClient & {
    roomState: Mock;
    getStateEvent: Mock;
} {
    return {
        loadStoredRoomState: vi.fn().mockResolvedValue(undefined),
        getRoom: (id: string) => rooms.find((r) => r.roomId === id) ?? null,
        getVisibleRooms: () => rooms,
        getAccountData: (type: string) =>
            accountData[type] ? new MatrixEvent({ type, content: accountData[type] }) : undefined,
        roomState: vi.fn().mockResolvedValue([]),
        getStateEvent: vi.fn().mockRejectedValue(new Error("M_NOT_FOUND")),
    } as unknown as MatrixClient & { roomState: Mock; getStateEvent: Mock };
}

describe("MSC2545 sticker packs", () => {
    beforeEach(() => clearImagePackCache());

    it("parses a Telegram bridge pack and skips emoticon-only images", () => {
        const pack = parseStickerPack("p", TELEGRAM_PACK, "fallback")!;
        expect(pack.name).toBe("Hot Cherry");
        expect(pack.images.map((i) => i.shortcode)).toEqual(["HotCherry_grinning", "HotCherry_heart"]);
        expect(parseStickerPack("e", EMOJI_PACK, "fallback")).toBeUndefined();
        // No usage anywhere: usable as both.
        expect(parseStickerPack("n", { images: { a: { url: "mxc://x/a" } } }, "fallback")!.name).toBe("fallback");
        // Image usage overrides pack usage.
        expect(
            parseStickerPack(
                "o",
                { images: { a: { url: "mxc://x/a", usage: ["sticker"] } }, pack: { usage: ["emoticon"] } },
                "f",
            )!.images,
        ).toHaveLength(1);
    });

    it("builds m.sticker content that keeps the bridge's original-sticker metadata", () => {
        const [image] = parseStickerPack("p", TELEGRAM_PACK, "f")!.images;
        expect(stickerContent(image)).toEqual({
            body: "😀",
            url: "mxc://example.org/cherry1",
            info: { "w": 512, "h": 512, "mimetype": "video/webm", "size": 1234, "fi.mau.bridged_sticker": BRIDGED },
        });

        // Metadata at the image's top level is kept too; the bridged sticker moves into info.
        const [top] = parseStickerPack(
            "t",
            {
                images: {
                    a: {
                        "url": "mxc://x/a",
                        "fi.mau.bridged_sticker": BRIDGED,
                        "fi.mau.telegram.emoji": "😀",
                        "com.example.ignored": true,
                    },
                },
            },
            "f",
        )!.images;
        expect(stickerContent(top)).toEqual({
            "body": "a",
            "url": "mxc://x/a",
            "info": { "fi.mau.bridged_sticker": BRIDGED },
            "fi.mau.telegram.emoji": "😀",
        });
    });

    it("collects packs from the room, user_emotes, emote_rooms and joined spaces, deduplicated", async () => {
        const current = fakeRoom("!dm:x", { "": { images: { own: { url: "mxc://x/own" } } } });
        const listed = fakeRoom("!listed:x", {
            a: TELEGRAM_PACK,
            b: { ...TELEGRAM_PACK, pack: { display_name: "B" } },
        });
        const space = fakeRoom("!space:x", {}, { space: true, name: "Telegram" });
        const client = fakeClient([current, listed, space], {
            "im.ponies.user_emotes": { images: { mine: { url: "mxc://x/mine" } }, pack: { display_name: "Mine" } },
            // The bridge space listed explicitly as well: still only once.
            "im.ponies.emote_rooms": { rooms: { "!listed:x": { a: {} }, "!space:x": {} } },
        });
        // The space's state isn't loaded locally (sliding sync): fetched from the server.
        client.roomState.mockImplementation(async (roomId: string) =>
            roomId === "!space:x"
                ? [
                      { type: "im.ponies.room_emotes", state_key: "HotCherry", content: TELEGRAM_PACK },
                      { type: "m.space.child", state_key: "!dm:x", content: {} },
                  ]
                : [],
        );

        const packs = await loadStickerPacks(client, current);
        expect(packs.map((p) => [p.id, p.name])).toEqual([
            ["room:!dm:x/", "!dm:x"],
            ["user", "Mine"],
            ["room:!listed:x/a", "Hot Cherry"],
            ["room:!space:x/HotCherry", "Hot Cherry"],
        ]);
        expect(client.roomState).toHaveBeenCalledWith("!space:x");
        expect(client.roomState).toHaveBeenCalledTimes(1); // cached
        expect(client.roomState).not.toHaveBeenCalledWith("!dm:x");
    });

    it("reads the stable m.room.image_pack type the Telegram bridge's pack sync sends", async () => {
        const current = fakeRoom("!dm:x", {});
        const space = fakeRoom("!tgspace:x", {}, { space: true, name: "Telegram" });
        const client = fakeClient([current, space]);
        client.getStateEvent.mockRejectedValue(new Error("M_NOT_FOUND"));
        client.roomState.mockImplementation(async (roomId: string) =>
            roomId === "!tgspace:x"
                ? [
                      { type: "m.room.image_pack", state_key: "HotCherry", content: TELEGRAM_PACK },
                      { type: "m.room.image_pack", state_key: "Empty", content: {} },
                  ]
                : [],
        );
        const packs = await loadStickerPacks(client, current);
        expect(packs.map((p) => [p.id, p.name])).toEqual([["room:!tgspace:x/HotCherry", "Hot Cherry"]]);
    });

    it("only fetches the default pack of the open room when its state isn't loaded", async () => {
        const current = fakeRoom("!big:x", {});
        const client = fakeClient([current]);
        client.getStateEvent.mockResolvedValue(TELEGRAM_PACK);
        const packs = await loadStickerPacks(client, current);
        expect(client.getStateEvent).toHaveBeenCalledWith("!big:x", "im.ponies.room_emotes", "");
        expect(client.roomState).not.toHaveBeenCalled();
        expect(packs.map((p) => p.name)).toEqual(["Hot Cherry"]);
    });

    it("returns nothing when there are no packs", async () => {
        const client = fakeClient([fakeRoom("!r:x", {})]);
        expect(await loadStickerPacks(client, client.getRoom("!r:x")!)).toEqual([]);
    });
});
