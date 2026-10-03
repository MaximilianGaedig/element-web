/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it, vi } from "vitest";
import { Direction, type MatrixClient, MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";

import { extractLinks, isVoice, SharedMediaLoader, sharedMediaTab, tabCountsFromStats } from "./sharedMedia";

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

    it("takes a voice flag's presence as the flag, whatever it holds", () => {
        // What mautrix bridges send: an empty MSC3245 object beside the MSC1767 waveform.
        expect(isVoice({ "org.matrix.msc3245.voice": {}, "org.matrix.msc1767.audio": { duration: 3000 } })).toBe(true);
        expect(isVoice({ "org.matrix.msc2516.voice": {} })).toBe(true);
        expect(isVoice({ "m.voice": {} })).toBe(true);
        expect(isVoice({ "org.matrix.msc1767.audio": { duration: 3000 } })).toBe(false);
    });

    it("leaves out mentions and forward headers, which link to a person or a room", () => {
        const mention = msg({
            msgtype: "m.text",
            body: "Ana: hi",
            format: "org.matrix.custom.html",
            formatted_body: '<a href="https://matrix.to/#/@ana:x">Ana</a>: hi',
        });
        expect(extractLinks(mention)).toEqual([]);
        expect(sharedMediaTab(mention)).toBeUndefined();
        const forward = msg({
            msgtype: "m.text",
            body: "Forwarded message from News\n> read https://example.org/story",
            format: "org.matrix.custom.html",
            formatted_body:
                'Forwarded message from <a href="https://matrix.to/#/%23news:x">News</a><br>' +
                '<blockquote data-telegram-forward>read <a href="https://example.org/story">https://example.org/story</a></blockquote>',
        });
        // The link the forwarded message carries is still one.
        expect(extractLinks(forward)).toEqual(["https://example.org/story"]);
        // A link to a message is something somebody shared.
        expect(extractLinks(msg({ msgtype: "m.text", body: "see https://matrix.to/#/!r:x/$ev" }))).toHaveLength(1);
    });

    it("reads links of kinds it doesn't know without logging errors", () => {
        const error = vi.spyOn(console, "error");
        // matrix.to links that aren't a person, a room or a message, e.g. old community links.
        expect(extractLinks(msg({ msgtype: "m.text", body: "https://matrix.to/#/+community:x" }))).toHaveLength(1);
        expect(extractLinks(msg({ msgtype: "m.text", body: "https://matrix.to/#/" }))).toHaveLength(1);
        expect(error).not.toHaveBeenCalled();
    });

    it("leaves out the links of the message a reply quotes", () => {
        const reply = msg({
            "msgtype": "m.text",
            "body": "> <@b:x> look https://example.org/quoted\n\nnice",
            "format": "org.matrix.custom.html",
            "formatted_body":
                '<mx-reply><blockquote><a href="https://matrix.to/#/!r:x/$q">In reply to</a> ' +
                '<a href="https://matrix.to/#/@b:x">@b:x</a><br>look https://example.org/quoted</blockquote></mx-reply>nice',
            "m.relates_to": { "m.in_reply_to": { event_id: "$q" } },
        });
        expect(extractLinks(reply)).toEqual([]);
    });

    it("extracts links without trailing punctuation", () => {
        expect(extractLinks(msg({ msgtype: "m.text", body: "a (https://example.org/p?q=1), b http://x.io." }))).toEqual(
            ["https://example.org/p?q=1", "http://x.io/"],
        );
    });
});

describe("tabCountsFromStats", () => {
    it("maps the server's message kinds onto the tabs, stickers aside", () => {
        expect(
            tabCountsFromStats({ text: 229265, image: 4546, video: 5144, voice: 9, audio: 6, file: 9, sticker: 2180 }),
        ).toEqual({ media: 9690, files: 9, music: 6, voice: 9 });
    });

    it("counts links where the server counts them apart from text", () => {
        expect(tabCountsFromStats({ text: 100, link: 12 })).toEqual({ links: 12 });
        // An older homeserver says nothing about links, and the tab falls back to what it loaded.
        expect(tabCountsFromStats({ text: 100 }).links).toBeUndefined();
    });

    it("leaves out what the room has none of", () => {
        expect(tabCountsFromStats({ text: 10 })).toEqual({});
    });
});

describe("SharedMediaLoader with the server's media index", () => {
    function setup(pages: Record<string, Array<{ chunk: any[]; end?: string }>>) {
        const authedRequest = vi.fn(async (_method: any, _path: string, params: any) => {
            return pages[params.kind]?.shift() ?? { chunk: [] };
        });
        const client = {
            getSafeUserId: () => "@me:x",
            isRoomEncrypted: () => false,
            doesServerSupportUnstableFeature: vi.fn().mockResolvedValue(true),
            http: { authedRequest },
            getEventMapper: () => (raw: any) => new MatrixEvent(raw),
            decryptEventIfNeeded: vi.fn(),
        } as unknown as MatrixClient;
        const room = {
            roomId: "!r:x",
            getLiveTimeline: () => ({ getEvents: () => [], getPaginationToken: () => null }),
        } as unknown as Room;
        return { loader: new SharedMediaLoader(client, room), authedRequest };
    }

    it("loads a stretch by place, and settles the places the server had nothing for", async () => {
        const a = msg({ msgtype: "m.image", body: "a", url: "mxc://x/a" }, 300);
        const b = msg({ msgtype: "m.image", body: "b", url: "mxc://x/b" }, 200);
        // Places 120-123 were looked at: 121 and 123 are the items, 120 and 122 held nothing to show.
        const { loader, authedRequest } = setup({
            media: [{ chunk: [a.event, b.event], positions: [121, 123], next_position: 124 } as any],
        });

        await loader.loadPlaces("media", 120, 60);

        expect(authedRequest.mock.calls[0][2]).toMatchObject({ kind: "media", skip: "120", limit: "60" });
        const state = loader.state("media");
        expect(state.places.get(a.getId()!)).toBe(121);
        expect(state.places.get(b.getId()!)).toBe(123);
        expect([...state.empty]).toEqual([120, 122]);
    });

    it("is done once every place the month counts promise has been answered", async () => {
        const a = msg({ msgtype: "m.image", body: "a", url: "mxc://x/a" }, 300);
        const b = msg({ msgtype: "m.image", body: "b", url: "mxc://x/b" }, 200);
        // Four places in all: two items and two the server holds nothing to show for.
        const months = [{ month: "2026-09", count: 4, before_ts: 400 }];
        const { loader } = setup({
            media: [
                { chunk: [], months } as any,
                { chunk: [a.event], positions: [0], next_position: 2 } as any,
                { chunk: [b.event], positions: [3], next_position: 4 } as any,
            ],
        });
        await loader.monthCounts("media");

        await loader.loadPlaces("media", 0, 2);
        expect(loader.state("media").done).toBe(false);
        await loader.loadPlaces("media", 2, 2);
        expect(loader.state("media").done).toBe(true);
    });

    it("opens the list at a date instead of paging back to it", async () => {
        const march = msg({ msgtype: "m.image", body: "march", url: "mxc://x/m" }, 300);
        const { loader, authedRequest } = setup({ media: [{ chunk: [march.event], end: "t-march" }] });

        await loader.seekTo("media", 350);

        // The server is told where to start, so a year back costs one request rather than a page
        // for every month in between.
        expect(authedRequest.mock.calls[0][2]).toMatchObject({ kind: "media", before_ts: "350" });
        expect(loader.state("media").items.map((e) => e.getId())).toEqual([march.getId()]);
    });

    /*
     * After a jump the reader is at the month jumped to, and scrolling on means older. Paging from the
     * newest history instead added only what lies above, which slid the column up under the reader.
     */
    it("after a jump, loads what is older than the month jumped to, then pages from the newest", async () => {
        const newest = msg({ msgtype: "m.image", body: "newest", url: "mxc://x/n" }, 900);
        const march = msg({ msgtype: "m.image", body: "march", url: "mxc://x/m" }, 300);
        const feb = msg({ msgtype: "m.image", body: "feb", url: "mxc://x/f" }, 200);
        const authedRequest = vi.fn(async (_method: any, _path: string, params: any) => {
            if (params.before_ts === "350") return { chunk: [march.event], end: "t" };
            if (params.before_ts === "299") return { chunk: [feb.event], end: "t" };
            if (params.before_ts === "199") return { chunk: [] };
            return { chunk: [newest.event] };
        });
        const client = {
            getSafeUserId: () => "@me:x",
            isRoomEncrypted: () => false,
            doesServerSupportUnstableFeature: vi.fn().mockResolvedValue(true),
            http: { authedRequest },
            getEventMapper: () => (raw: any) => new MatrixEvent(raw),
            decryptEventIfNeeded: vi.fn(),
        } as unknown as MatrixClient;
        const room = {
            roomId: "!r:x",
            getLiveTimeline: () => ({ getEvents: () => [], getPaginationToken: () => null }),
        } as unknown as Room;
        const loader = new SharedMediaLoader(client, room);

        await loader.seekTo("media", 350);
        await loader.loadMore("media");
        // Older than the oldest held, not the newest history - until nothing older is left.
        expect(authedRequest.mock.calls[1][2]).toMatchObject({ before_ts: "299" });
        expect(authedRequest.mock.calls[2][2]).toMatchObject({ before_ts: "199" });
        // Then paging from the newest takes over, without a token a seek moved.
        expect(authedRequest.mock.calls[3][2]).not.toHaveProperty("before_ts");
        expect(authedRequest.mock.calls[3][2]).not.toHaveProperty("from");
        expect(loader.state("media").items.map((e) => e.getContent().body)).toEqual(["newest", "march", "feb"]);
    });

    it("a short seek does not declare the tab finished", async () => {
        const march = msg({ msgtype: "m.image", body: "march", url: "mxc://x/m" }, 300);
        const { loader } = setup({ media: [{ chunk: [march.event], end: undefined }] });

        await loader.seekTo("media", 350);

        // A seek into the middle of the history comes back short by its nature. Reading that as
        // "nothing left" would stop the list ever loading more.
        expect(loader.state("media").done).toBe(false);
    });

    it("asks the server what each month holds, once, so the scrubber can be sized", async () => {
        const months = [{ month: "2026-03", count: 12, before_ts: 350 }];
        const { loader, authedRequest } = setup({ media: [{ chunk: [], months } as any] });

        expect(await loader.monthCounts("media")).toEqual(months);
        // Kept: a scrubber whose length changes while it is being dragged is worse than none.
        expect(await loader.monthCounts("media")).toEqual(months);
        expect(authedRequest).toHaveBeenCalledTimes(1);
        expect(authedRequest.mock.calls[0][2]).toMatchObject({ months: "true" });
    });

    it("finishing one tab leaves the others to load: the index answers each kind on its own", async () => {
        const img = msg({ msgtype: "m.image", body: "a", url: "mxc://x/a" }, 100);
        const voice = msg({ "msgtype": "m.audio", "body": "v.ogg", "org.matrix.msc3245.voice": {} }, 50);
        const { loader } = setup({ media: [{ chunk: [img.event] }], voice: [{ chunk: [voice.event] }] });

        await loader.loadMore("media");
        expect(loader.state("media").done).toBe(true);
        expect(loader.state("voice").done).toBe(false);

        await loader.loadMore("voice");
        expect(loader.state("voice").items.map((e) => e.getId())).toEqual([voice.getId()]);
    });

    it("stops after a bounded number of requests when a kind's entries aren't listed here", async () => {
        // The index counts stickers as media; the tabs don't list them, so the pages look empty.
        const sticker = (i: number): any =>
            msg({
                msgtype: "m.video",
                body: `s${i}`,
                url: "mxc://x/s",
                info: { "fi.mau.telegram.animated_sticker": true },
            }).event;
        const pages = Array.from({ length: 50 }, (_, p) => ({
            chunk: Array.from({ length: 50 }, (_, i) => sticker(p * 50 + i)),
            end: `t${p}`,
        }));
        const { loader, authedRequest } = setup({ media: pages });
        await loader.loadMore("media");
        expect(loader.state("media").items).toEqual([]);
        expect(authedRequest.mock.calls.length).toBeLessThanOrEqual(6);
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

    it("puts an event where its timestamp says, not where it arrived", async () => {
        // What an encrypted room does: a page is decrypted all at once and each decryption arrives on
        // its own, in whatever order the crypto worker finished, through MatrixEventEvent.Decrypted.
        // Taking an arrival for the newest item left the whole page sitting above the live messages.
        const newest = msg({ msgtype: "m.file", body: "newest", url: "mxc://x/n" }, 500);
        const { loader } = setup([newest], []);
        for (const ts of [100, 300, 50, 200]) {
            loader.addLive(msg({ msgtype: "m.file", body: `t${ts}`, url: `mxc://x/${ts}` }, ts));
        }
        expect(loader.state("files").items.map((e) => e.getContent().body)).toEqual([
            "newest",
            "t300",
            "t200",
            "t100",
            "t50",
        ]);
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
