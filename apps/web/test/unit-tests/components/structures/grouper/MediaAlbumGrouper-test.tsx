/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React from "react";
import { type MatrixEvent, Relations, Room, RoomMember } from "matrix-js-sdk/src/matrix";
import { act, fireEvent, render, screen, waitFor, within } from "jest-matrix-react";

import MessagePanel from "../../../../../src/components/structures/MessagePanel";
import SettingsStore from "../../../../../src/settings/SettingsStore";
import RoomContext, { type RoomContextType, TimelineRenderingType } from "../../../../../src/contexts/RoomContext";
import DMRoomMap from "../../../../../src/utils/DMRoomMap";
import {
    clientAndSDKContextRenderOptions,
    getMockClientWithEventEmitter,
    mkEvent,
    mockClientMethodsCrypto,
    mockClientMethodsEvents,
    mockClientMethodsUser,
    mockClientPushProcessor,
} from "../../../../test-utils";
import { MatrixClientPeg } from "../../../../../src/MatrixClientPeg";
import { ScopedRoomContextProvider } from "../../../../../src/contexts/ScopedRoomContext";
import { SdkContextClass } from "../../../../../src/contexts/SDKContext";
import Modal from "../../../../../src/Modal";
import { MediaPreviewValue } from "../../../../../src/@types/media_preview";

jest.mock("../../../../../src/utils/beacon", () => ({ useBeacon: jest.fn() }));

const roomId = "!room:example.org";
const ALICE = "@alice:example.org";
const BOB = "@bob:example.org";

describe("MediaAlbumGrouper", () => {
    const client = getMockClientWithEventEmitter({
        ...mockClientMethodsUser("@me:example.org"),
        ...mockClientMethodsEvents(),
        ...mockClientMethodsCrypto(),
        ...mockClientPushProcessor(),
        getAccountData: jest.fn(),
        isUserIgnored: jest.fn().mockReturnValue(false),
        isRoomEncrypted: jest.fn().mockReturnValue(false),
        getRoom: jest.fn(),
        getClientWellKnown: jest.fn().mockReturnValue({}),
        supportsThreads: jest.fn().mockReturnValue(true),
        mxcUrlToHttp: jest.fn().mockImplementation((mxc: string) => `https://media.example/${mxc.substring(6)}`),
    });
    jest.spyOn(MatrixClientPeg, "get").mockReturnValue(client);
    const room = new Room(roomId, client, "@me:example.org");
    for (const [id, name] of [
        [ALICE, "Alice"],
        [BOB, "Bob"],
    ]) {
        const member = new RoomMember(roomId, id);
        member.name = name;
        jest.spyOn(room, "getMember").mockImplementation((u) => (u === id ? member : null));
    }

    let sdkContext: SdkContextClass;
    let nativeGrouping: boolean;
    let now: number;

    beforeEach(() => {
        jest.clearAllMocks();
        nativeGrouping = true;
        now = Date.now();
        jest.spyOn(SettingsStore, "getValue").mockImplementation((name: string): any => {
            if (name === "groupConsecutiveImages") return nativeGrouping;
            if (name === "mediaPreviewConfig") {
                return { media_previews: MediaPreviewValue.On, invite_avatars: MediaPreviewValue.On };
            }
            if (name === "showMediaEventIds") return {};
            return name === "showDisplaynameChanges";
        });
        sdkContext = new SdkContextClass();
        DMRoomMap.makeShared(client);
    });

    afterEach(() => {
        act(() => Modal.forceCloseAllModals());
    });

    const roomContext = (type = TimelineRenderingType.Room): RoomContextType =>
        ({
            ...RoomContext,
            timelineRenderingType: type,
            room,
            roomId,
            canReact: true,
            canSendMessages: true,
            showReadReceipts: false,
            showRedactions: false,
            showHiddenEvents: false,
        }) as unknown as RoomContextType;

    const panel = (events: MatrixEvent[], props: Record<string, unknown> = {}, type?: TimelineRenderingType) => (
        <ScopedRoomContextProvider {...roomContext(type)}>
            <MessagePanel callEventGroupers={new Map()} room={room} className="cls" events={events} {...props} />
        </ScopedRoomContextProvider>
    );

    const renderPanel = (events: MatrixEvent[], props?: Record<string, unknown>, type?: TimelineRenderingType) =>
        render(panel(events, props, type), clientAndSDKContextRenderOptions(client, sdkContext));

    let seq = 0;
    function media(
        opts: {
            sender?: string;
            album?: Record<string, unknown>;
            msgtype?: string;
            body?: string;
            filename?: string;
            ts?: number;
            id?: string;
        } = {},
    ): MatrixEvent {
        const n = seq++;
        return mkEvent({
            event: true,
            type: "m.room.message",
            room: roomId,
            user: opts.sender ?? ALICE,
            id: opts.id ?? `$media${n}`,
            ts: opts.ts ?? now + n,
            content: {
                msgtype: opts.msgtype ?? "m.image",
                body: opts.body ?? `p${n}.jpg`,
                ...(opts.filename ? { filename: opts.filename } : {}),
                url: `mxc://example.org/m${n}`,
                info: { w: 100, h: 100, mimetype: opts.msgtype === "m.video" ? "video/mp4" : "image/jpeg", size: 10 },
                ...(opts.album ? { "fi.mau.album": opts.album } : {}),
            },
        });
    }

    function text(sender: string, body: string, ts?: number): MatrixEvent {
        return mkEvent({
            event: true,
            type: "m.room.message",
            room: roomId,
            user: sender,
            ts: ts ?? now + seq++,
            content: { msgtype: "m.text", body },
        });
    }

    function album(n: number, id = "A", sender = ALICE, count: number | undefined = n): MatrixEvent[] {
        return Array.from({ length: n }, (_, index) =>
            media({ sender, album: { id, index, ...(count !== undefined ? { count } : {}) } }),
        );
    }

    const tiles = (container: HTMLElement) => container.querySelectorAll(".mx_EventTile");
    const grids = (container: HTMLElement) => container.querySelectorAll("[data-testid='album-grid']");
    const cellTitles = (grid: Element) =>
        [...grid.querySelectorAll("[data-testid='album-cell']")].map((c) => c.getAttribute("title"));

    describe("layouts", () => {
        it.each([
            [2, "n2"],
            [3, "n3"],
            [4, "n4"],
            [6, "n6"],
        ])("renders %i items as one tile with the %s grid", (n, variant) => {
            const { container } = renderPanel(album(n));
            expect(tiles(container)).toHaveLength(1);
            const [grid] = grids(container);
            expect(grid).toHaveClass(`mx_MAlbumBody_grid_${variant}`);
            expect(within(grid as HTMLElement).getAllByTestId("album-cell")).toHaveLength(n);
            expect(screen.queryByTestId("album-overflow")).toBeNull();
        });

        it("caps the grid at 6 cells with a +N overlay", () => {
            const { container } = renderPanel(album(8));
            const [grid] = grids(container);
            expect(grid).toHaveClass("mx_MAlbumBody_grid_n6");
            expect(within(grid as HTMLElement).getAllByTestId("album-cell")).toHaveLength(6);
            expect(screen.getByTestId("album-overflow")).toHaveTextContent("+2");
        });

        it("renders a group of one exactly like an ungrouped image", () => {
            const { container } = renderPanel([media({ album: { id: "A", index: 0, count: 1 } })]);
            expect(tiles(container)).toHaveLength(1);
            expect(grids(container)).toHaveLength(0);
            expect(container.querySelector(".mx_MImageBody")).not.toBeNull();
        });
    });

    describe("grouping rule", () => {
        it("splits on sender", () => {
            const { container } = renderPanel([...album(2, "A", ALICE), ...album(2, "A", BOB)]);
            expect(tiles(container)).toHaveLength(2);
            expect(grids(container)).toHaveLength(2);
        });

        it("splits on album id", () => {
            const { container } = renderPanel([...album(2, "A"), ...album(3, "B")]);
            const g = grids(container);
            expect(g).toHaveLength(2);
            expect(cellTitles(g[0])).toHaveLength(2);
            expect(cellTitles(g[1])).toHaveLength(3);
        });

        it("is broken by a visible event from another sender", () => {
            const [a0, a1] = album(2);
            const { container } = renderPanel([a0, text(BOB, "hi"), a1]);
            expect(grids(container)).toHaveLength(0);
            expect(tiles(container)).toHaveLength(3);
        });

        it("is not broken by the same sender's text, which is shown after the grid", () => {
            const [a0, a1, a2] = album(3);
            const { container } = renderPanel([a0, text(ALICE, "in between"), a1, a2]);
            const t = tiles(container);
            expect(t).toHaveLength(2);
            expect(within(t[0] as HTMLElement).getAllByTestId("album-cell")).toHaveLength(3);
            expect(t[1]).toHaveTextContent("in between");
        });

        it("sorts items by index regardless of arrival order", () => {
            const e0 = media({ album: { id: "A", index: 0 }, body: "zero.jpg" });
            const e1 = media({ album: { id: "A", index: 1 }, body: "one.jpg" });
            const e2 = media({ album: { id: "A", index: 2 }, body: "two.jpg" });
            const { container } = renderPanel([e2, e0, e1]);
            expect(cellTitles(grids(container)[0])).toEqual(["zero.jpg", "one.jpg", "two.jpg"]);
        });

        it("lets late items join the existing tile in place, filling reserved slots", () => {
            const [a0, a1, a2] = album(3, "A", ALICE, 3);
            const { container, rerender } = renderPanel([a0, a1]);
            const tileBefore = tiles(container)[0];
            const gridBefore = grids(container)[0];
            expect(gridBefore).toHaveClass("mx_MAlbumBody_grid_n3");
            expect(screen.getAllByTestId("album-placeholder")).toHaveLength(1);

            rerender(panel([a0, a1, a2]));
            expect(tiles(container)).toHaveLength(1);
            expect(tiles(container)[0]).toBe(tileBefore);
            expect(grids(container)[0]).toBe(gridBefore);
            expect(gridBefore).toHaveClass("mx_MAlbumBody_grid_n3");
            expect(screen.queryAllByTestId("album-placeholder")).toHaveLength(0);
            expect(cellTitles(gridBefore)).toHaveLength(3);
        });

        it("keeps the tile when the album grows from one item to two", () => {
            const [a0, a1] = album(2, "A", ALICE, undefined);
            const { container, rerender } = renderPanel([a0]);
            const tileBefore = tiles(container)[0];
            expect(grids(container)).toHaveLength(0);
            rerender(panel([a0, a1]));
            expect(tiles(container)[0]).toBe(tileBefore);
            expect(grids(container)).toHaveLength(1);
        });

        it("drops redacted items from the grid", () => {
            const items = album(3, "A", ALICE, undefined);
            const { container, rerender } = renderPanel(items);
            expect(cellTitles(grids(container)[0])).toHaveLength(3);

            const redaction = mkEvent({
                event: true,
                type: "m.room.redaction",
                room: roomId,
                user: ALICE,
                content: {},
                redacts: items[1].getId(),
            });
            items[1].makeRedacted(redaction, room);
            rerender(panel([...items]));
            expect(tiles(container)).toHaveLength(1);
            expect(cellTitles(grids(container)[0])).toHaveLength(2);
        });
    });

    describe("captions and edits", () => {
        it("shows the caption of whichever item carries one", () => {
            const e0 = media({ album: { id: "A", index: 0 }, filename: "a.jpg", body: "a.jpg" });
            const e1 = media({ album: { id: "A", index: 1 }, filename: "b.jpg", body: "Summer holidays" });
            renderPanel([e0, e1]);
            const captions = screen.getAllByTestId("album-caption");
            expect(captions).toHaveLength(1);
            expect(captions[0]).toHaveTextContent("Summer holidays");
        });

        it("re-renders when an item is edited", async () => {
            const e0 = media({ album: { id: "A", index: 0 } });
            const e1 = media({ album: { id: "A", index: 1 }, filename: "b.jpg", body: "Old caption" });
            renderPanel([e0, e1]);
            expect(screen.getByTestId("album-caption")).toHaveTextContent("Old caption");

            const edit = mkEvent({
                event: true,
                type: "m.room.message",
                room: roomId,
                user: ALICE,
                content: {
                    "msgtype": "m.image",
                    "body": "* New caption",
                    "m.new_content": {
                        msgtype: "m.image",
                        body: "New caption",
                        filename: "b.jpg",
                        url: e1.getContent().url,
                    },
                    "m.relates_to": { rel_type: "m.replace", event_id: e1.getId() },
                },
            });
            e1.makeReplaced(edit);
            await waitFor(() => expect(screen.getByTestId("album-caption")).toHaveTextContent("New caption"));
        });
    });

    it("aggregates the reactions of all items onto the album tile", () => {
        const items = album(3);
        const relations = new Map<string, Relations>();
        const react = (target: MatrixEvent, key: string, sender: string): void => {
            let r = relations.get(target.getId()!);
            if (!r) {
                r = new Relations("m.annotation", "m.reaction", client);
                relations.set(target.getId()!, r);
            }
            void r.addEvent(
                mkEvent({
                    event: true,
                    type: "m.reaction",
                    room: roomId,
                    user: sender,
                    content: { "m.relates_to": { rel_type: "m.annotation", event_id: target.getId(), key } },
                }),
            );
        };
        react(items[1], "👍", BOB);
        react(items[2], "👍", "@carol:example.org");
        react(items[2], "🎉", BOB);

        const getRelationsForEvent = (eventId: string, relType: string, eventType: string) =>
            relType === "m.annotation" && eventType === "m.reaction" ? relations.get(eventId) : undefined;
        const { container } = renderPanel(items, { showReactions: true, getRelationsForEvent });

        const rows = container.querySelectorAll(".mx_ReactionsRow");
        expect(rows).toHaveLength(1);
        const buttons = [...rows[0].querySelectorAll("[role='button'], button")].map((b) => b.textContent);
        expect(buttons).toEqual(expect.arrayContaining(["👍2", "🎉1"]));
    });

    describe("native grouping setting", () => {
        it("groups consecutive images sent within 60 s when enabled", () => {
            const { container } = renderPanel([media({ ts: now }), media({ ts: now + 30_000, msgtype: "m.video" })]);
            expect(grids(container)).toHaveLength(1);
            expect(tiles(container)).toHaveLength(1);
        });

        it("does not group when disabled", () => {
            nativeGrouping = false;
            const { container } = renderPanel([media({ ts: now }), media({ ts: now + 30_000 })]);
            expect(grids(container)).toHaveLength(0);
            expect(tiles(container)).toHaveLength(2);
        });

        it("does not group across a gap of more than 60 s or across text", () => {
            const { container } = renderPanel([
                media({ ts: now }),
                media({ ts: now + 61_000 }),
                text(ALICE, "caption", now + 62_000),
                media({ ts: now + 63_000 }),
            ]);
            expect(grids(container)).toHaveLength(0);
            expect(tiles(container)).toHaveLength(4);
        });
    });

    describe("timelines", () => {
        it("groups inside thread timelines", () => {
            const { container } = renderPanel(album(3), {}, TimelineRenderingType.Thread);
            expect(grids(container)).toHaveLength(1);
        });

        it("does not group in the file panel", () => {
            const { container } = renderPanel(album(3), {}, TimelineRenderingType.File);
            expect(grids(container)).toHaveLength(0);
        });
    });

    it("opens the lightbox and navigates across the album", async () => {
        renderPanel(album(3));
        fireEvent.click(screen.getAllByTestId("album-cell")[0]);
        const lightbox = await screen.findByTestId("album-lightbox");
        expect(within(lightbox).getByText("1 / 3")).toBeInTheDocument();
        fireEvent.click(within(lightbox).getByRole("button", { name: "Next" }));
        expect(within(lightbox).getByText("2 / 3")).toBeInTheDocument();
        fireEvent.keyDown(window, { key: "ArrowLeft" });
        fireEvent.keyDown(window, { key: "ArrowLeft" });
        expect(within(lightbox).getByText("3 / 3")).toBeInTheDocument();
    });
});
