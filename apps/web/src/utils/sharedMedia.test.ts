/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it, vi } from "vitest";
import { Direction, type MatrixClient, MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";

import { extractLinks, SharedMediaLoader, sharedMediaTab } from "./sharedMedia";

let n = 0;
function msg(content: Record<string, unknown>, ts = 1000): MatrixEvent {
    return new MatrixEvent({
        type: "m.room.message",
        event_id: `$e${++n}`,
        room_id: "!r:x",
        sender: "@a:x",
        origin_server_ts: ts,
        content,
    });
}

describe("sharedMediaTab", () => {
    it("sorts messages into tweb's tabs", () => {
        expect(sharedMediaTab(msg({ msgtype: "m.image", body: "a.jpg", url: "mxc://x/a" }))).toBe("media");
        expect(sharedMediaTab(msg({ msgtype: "m.video", body: "a.mp4", url: "mxc://x/a" }))).toBe("media");
        expect(sharedMediaTab(msg({ msgtype: "m.file", body: "a.pdf", url: "mxc://x/a" }))).toBe("files");
        expect(sharedMediaTab(msg({ msgtype: "m.audio", body: "song.mp3", url: "mxc://x/a" }))).toBe("music");
        expect(sharedMediaTab(msg({ "msgtype": "m.audio", "body": "v.ogg", "org.matrix.msc3245.voice": {} }))).toBe(
            "voice",
        );
        expect(sharedMediaTab(msg({ msgtype: "m.text", body: "see https://example.org/x." }))).toBe("links");
        expect(sharedMediaTab(msg({ msgtype: "m.text", body: "no links here" }))).toBeUndefined();
        // Animated stickers aren't media.
        expect(
            sharedMediaTab(
                msg({
                    msgtype: "m.video",
                    body: "s",
                    url: "mxc://x/s",
                    info: { "fi.mau.telegram.animated_sticker": true },
                }),
            ),
        ).toBeUndefined();
    });

    it("extracts links without trailing punctuation", () => {
        expect(extractLinks(msg({ msgtype: "m.text", body: "a (https://example.org/p?q=1), b http://x.io." }))).toEqual(
            ["https://example.org/p?q=1", "http://x.io/"],
        );
    });
});

describe("SharedMediaLoader", () => {
    function setup(liveEvents: MatrixEvent[], pages: Array<{ chunk: any[]; end?: string }>) {
        const createMessagesRequest = vi.fn();
        for (const page of pages) createMessagesRequest.mockResolvedValueOnce(page);
        const client = {
            getSafeUserId: () => "@me:x",
            isRoomEncrypted: () => false,
            createMessagesRequest,
            getEventMapper: () => (raw: any) => new MatrixEvent(raw),
            decryptEventIfNeeded: vi.fn(),
        } as unknown as MatrixClient;
        const room = {
            roomId: "!r:x",
            getLiveTimeline: () => ({
                getEvents: () => liveEvents,
                getPaginationToken: (dir: Direction) => (dir === Direction.Backward ? "t0" : null),
            }),
        } as unknown as Room;
        return { loader: new SharedMediaLoader(client, room), createMessagesRequest };
    }

    it("shows the cached timeline at once, newest first, then pages older history with contains_url", async () => {
        const older = msg({ msgtype: "m.image", body: "old", url: "mxc://x/o" }, 10);
        const a = msg({ msgtype: "m.image", body: "a", url: "mxc://x/a" }, 100);
        const b = msg({ msgtype: "m.image", body: "b", url: "mxc://x/b" }, 200);
        const { loader, createMessagesRequest } = setup([a, b], [{ chunk: [older.event], end: undefined }]);
        expect(loader.state("media").items.map((e) => e.getContent().body)).toEqual(["b", "a"]);
        expect(loader.state("media").done).toBe(false);

        await loader.loadMore("media");
        const [, from, limit, dir, filter] = createMessagesRequest.mock.calls[0];
        expect([from, limit, dir]).toEqual(["t0", 50, Direction.Backward]);
        expect(filter.getRoomTimelineFilterComponent().toJSON()).toMatchObject({ contains_url: true });
        expect(loader.state("media").items.map((e) => e.getContent().body)).toEqual(["b", "a", "old"]);
        expect(loader.state("media").done).toBe(true);
    });

    it("keeps loading after its owner's effect re-runs (StrictMode destroy, then attach)", async () => {
        const older = msg({ msgtype: "m.image", body: "old", url: "mxc://x/o" }, 10);
        const { loader } = setup([], [{ chunk: [older.event], end: undefined }]);
        // What React's StrictMode does to the owning effect in development: cleanup, then set up again.
        loader.destroy();
        loader.attach();
        const listener = vi.fn();
        loader.subscribe(listener);
        await loader.loadMore("media");
        expect(loader.state("media").loading).toBe(false);
        expect(loader.state("media").items.map((e) => e.getContent().body)).toEqual(["old"]);
        expect(listener).toHaveBeenCalled(); // the "loaded" state reaches the UI
    });

    it("adds live events first and drops redacted ones", () => {
        const a = msg({ msgtype: "m.file", body: "a", url: "mxc://x/a" }, 100);
        const { loader } = setup([a], []);
        const listener = vi.fn();
        loader.subscribe(listener);
        const live = msg({ msgtype: "m.file", body: "new", url: "mxc://x/n" }, 300);
        loader.addLive(live);
        loader.addLive(live); // duplicates are ignored
        expect(loader.state("files").items.map((e) => e.getContent().body)).toEqual(["new", "a"]);
        loader.remove(a.getId()!);
        expect(loader.state("files").items.map((e) => e.getContent().body)).toEqual(["new"]);
        expect(listener).toHaveBeenCalledTimes(2);
    });
});

describe("SharedMediaLoader without a pagination token", () => {
    it("pages from the latest event instead of reporting an empty room", async () => {
        const img = new MatrixEvent({
            type: "m.room.message",
            event_id: "$old",
            room_id: "!r:x",
            sender: "@a:x",
            origin_server_ts: 5,
            content: { msgtype: "m.image", body: "old", url: "mxc://x/o" },
        });
        const createMessagesRequest = vi.fn().mockResolvedValueOnce({ chunk: [img.event], end: "t1" });
        const client = {
            getSafeUserId: () => "@me:x",
            isRoomEncrypted: () => false,
            createMessagesRequest,
            getEventMapper: () => (raw: any) => new MatrixEvent(raw),
            decryptEventIfNeeded: vi.fn(),
        } as unknown as MatrixClient;
        const room = {
            roomId: "!r:x",
            getLiveTimeline: () => ({ getEvents: () => [], getPaginationToken: () => null }),
        } as unknown as Room;
        const loader = new SharedMediaLoader(client, room);
        expect(loader.state("media").done).toBe(false);
        await loader.loadMore("media");
        expect(createMessagesRequest.mock.calls[0][1]).toBeNull();
        expect(loader.state("media").items.map((e) => e.getId())).toEqual(["$old"]);
        expect(loader.state("media").done).toBe(false);
    });
});
