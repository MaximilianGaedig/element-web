/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockedObject } from "vitest";
import { act, fireEvent, render, screen } from "test-utils-rtl";
import { flushPromises, mkMembership, mkMessage, stubClient } from "test-utils";
import { type MatrixClient, MatrixEvent, Room } from "matrix-js-sdk/src/matrix";

import MatrixClientContext from "../../../contexts/MatrixClientContext";
import { SharedMediaPane, thumbSizeFor } from "./SharedMediaPanel";
import { SharedMediaLoader } from "../../../utils/sharedMedia";
import { floatingFloor } from "../../../utils/sharedMediaLayout";
import UIStore, { UI_EVENTS } from "../../../stores/UIStore";
import { fetchRoomStats, type RoomStats } from "../../../utils/chatHistory";

vi.mock("../../../utils/chatHistory", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../utils/chatHistory")>()),
    fetchRoomStats: vi.fn(),
}));

const roomId = "!room:example.org";

function image(id: string, body: string): MatrixEvent {
    return new MatrixEvent({
        type: "m.room.message",
        event_id: id,
        room_id: roomId,
        sender: "@alice:example.org",
        origin_server_ts: 1000,
        content: { msgtype: "m.image", body, url: "mxc://example.org/i" },
    });
}

function audio(id: string, body: string): MatrixEvent {
    return new MatrixEvent({
        type: "m.room.message",
        event_id: id,
        room_id: roomId,
        sender: "@alice:example.org",
        origin_server_ts: 1000,
        content: {
            msgtype: "m.audio",
            body: body,
            url: "mxc://example.org/a",
            info: { mimetype: "audio/mpeg", duration: 125000 },
        },
    });
}

describe("<SharedMediaPane />", () => {
    let client!: MockedObject<MatrixClient>;
    let room!: Room;

    beforeEach(() => {
        client = stubClient() as MockedObject<MatrixClient>;
        room = new Room(roomId, client, client.getSafeUserId());
        room.currentState.setStateEvents([
            mkMembership({ event: true, room: roomId, user: "@alice:example.org", name: "Alice", mship: "join" }),
        ]);
        client.getRoom.mockReturnValue(room);
        vi.mocked(fetchRoomStats).mockResolvedValue({
            total: 20,
            by_kind: { text: 5, image: 45, video: 6, audio: 2, voice: 9, file: 3 },
            senders: [],
            sender_count: 1,
            complete: true,
        } as RoomStats);
    });

    function renderTab(tab: "media" | "music" | "links", events: MatrixEvent[]) {
        room.addLiveEvents(events, { addToState: true });
        const loader = new SharedMediaLoader(client, room);
        return render(
            <MatrixClientContext.Provider value={client}>
                <SharedMediaPane loader={loader} tab={tab} />
            </MatrixClientContext.Provider>,
        );
    }

    it("counts the whole room from the server's numbers, not what happens to be loaded", async () => {
        renderTab("media", []);
        await flushPromises();
        expect(screen.getByText("45 photos, 6 videos")).toBeInTheDocument();
    });

    it("does not build an audio player for every track: one is built when it is played", async () => {
        renderTab("music", [audio("$a", "song.mp3"), audio("$b", "other.mp3")]);
        await flushPromises();
        expect(screen.getByText("2 tracks")).toBeInTheDocument();
        expect(screen.getByText("song.mp3")).toBeInTheDocument();
        expect(screen.getAllByText("2:05")).toHaveLength(2);
        expect(document.querySelector(".mx_MAudioBody")).not.toBeInTheDocument();
    });

    it("selects media and offers what to do with the selection", async () => {
        renderTab("media", [image("$i1", "a.jpg"), image("$i2", "b.jpg")]);
        await flushPromises();
        const items = document.querySelectorAll<HTMLElement>(".mx_SharedMedia_gridItem");
        expect(items).toHaveLength(2);
        // Ctrl-click starts a selection without going through the tab's menu.
        fireEvent.click(items[0], { ctrlKey: true });
        expect(screen.getByText("1 selected")).toBeInTheDocument();
        fireEvent.click(items[1]);
        expect(screen.getByText("2 selected")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Forward" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Download" })).toBeInTheDocument();
        // One message at a time can be shown where it was sent.
        expect(screen.queryByRole("button", { name: "Show in chat" })).not.toBeInTheDocument();
    });

    it("selects a run of pictures by dragging across them", async () => {
        renderTab("media", [image("$i1", "a.jpg"), image("$i2", "b.jpg"), image("$i3", "c.jpg")]);
        await flushPromises();
        const items = document.querySelectorAll<HTMLElement>(".mx_SharedMedia_gridItem");
        fireEvent.click(items[0], { ctrlKey: true });
        expect(screen.getByText("1 selected")).toBeInTheDocument();

        // Press on the second and drag over the third: both come with it.
        fireEvent.pointerDown(items[1]);
        fireEvent.pointerEnter(items[2]);
        expect(screen.getByText("3 selected")).toBeInTheDocument();

        // Dragging back off the third leaves it as it was before the drag, not selected.
        fireEvent.pointerEnter(items[1]);
        expect(screen.getByText("2 selected")).toBeInTheDocument();
        fireEvent.pointerUp(window);
    });

    it("does not open the picture on the click that ends a drag", async () => {
        renderTab("media", [image("$i1", "a.jpg"), image("$i2", "b.jpg")]);
        await flushPromises();
        const items = document.querySelectorAll<HTMLElement>(".mx_SharedMedia_gridItem");
        fireEvent.click(items[0], { ctrlKey: true });
        // Starting on an item that is not selected drags selection onto what it passes.
        fireEvent.pointerDown(items[1]);
        fireEvent.pointerEnter(items[0]);
        expect(screen.getByText("2 selected")).toBeInTheDocument();
        // The pointer comes up on the item it ended on, which the browser follows with a click.
        fireEvent.pointerUp(window);
        fireEvent.click(items[0]);
        expect(screen.getByText("2 selected")).toBeInTheDocument();
    });

    it("starts a selection by holding a picture, with nothing selected yet", async () => {
        vi.useFakeTimers();
        try {
            renderTab("media", [image("$i1", "a.jpg"), image("$i2", "b.jpg")]);
            await act(async () => {
                await vi.runOnlyPendingTimersAsync();
            });
            const items = document.querySelectorAll<HTMLElement>(".mx_SharedMedia_gridItem");
            expect(screen.queryByText("1 selected")).not.toBeInTheDocument();
            fireEvent.pointerDown(items[0]);
            act(() => {
                vi.advanceTimersByTime(500);
            });
            expect(screen.getByText("1 selected")).toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });

    it("names the sender of a link instead of showing their user ID", async () => {
        const link = mkMessage({
            event: true,
            room: roomId,
            user: "@alice:example.org",
            msg: "look at https://example.org/x",
        });
        renderTab("links", [link]);
        await flushPromises();
        expect(screen.getByText("Alice")).toBeInTheDocument();
        expect(screen.queryByText("@alice:example.org")).not.toBeInTheDocument();
    });

    describe("selecting by clicking", () => {
        // What a mouse does to a tile: the press, then the click that follows it.
        function tap(item: HTMLElement): void {
            fireEvent.pointerDown(item, { pointerType: "mouse" });
            fireEvent.pointerUp(window);
            fireEvent.click(item);
        }

        it("deselects a selected item with one click, and does not select it again", async () => {
            renderTab("media", [image("$i1", "a.jpg"), image("$i2", "b.jpg")]);
            await flushPromises();
            const items = document.querySelectorAll<HTMLElement>(".mx_SharedMedia_gridItem");
            fireEvent.click(items[0], { ctrlKey: true });
            tap(items[1]);
            expect(screen.getByText("2 selected")).toBeInTheDocument();

            tap(items[1]);
            expect(screen.getByText("1 selected")).toBeInTheDocument();
            expect(items[1]).toHaveAttribute("aria-pressed", "false");
        });

        it("selects an unselected item with one click, and does not deselect it again", async () => {
            renderTab("media", [image("$i1", "a.jpg"), image("$i2", "b.jpg"), image("$i3", "c.jpg")]);
            await flushPromises();
            const items = document.querySelectorAll<HTMLElement>(".mx_SharedMedia_gridItem");
            fireEvent.click(items[0], { ctrlKey: true });

            tap(items[1]);
            expect(screen.getByText("2 selected")).toBeInTheDocument();
            tap(items[2]);
            expect(screen.getByText("3 selected")).toBeInTheDocument();
        });

        it("still reaches back to where the selection started on shift-click", async () => {
            renderTab("media", [image("$i1", "a.jpg"), image("$i2", "b.jpg"), image("$i3", "c.jpg")]);
            await flushPromises();
            const items = document.querySelectorAll<HTMLElement>(".mx_SharedMedia_gridItem");
            fireEvent.click(items[0], { ctrlKey: true });
            fireEvent.pointerDown(items[2], { pointerType: "mouse", shiftKey: true });
            fireEvent.pointerUp(window);
            fireEvent.click(items[2], { shiftKey: true });
            expect(screen.getByText("3 selected")).toBeInTheDocument();
        });
    });

    describe("while more is loading", () => {
        function renderLoading(tab: "media" | "links", over: { loading: boolean; done: boolean }) {
            // Without the server's counts the grid has no placeholders of its own to show.
            vi.mocked(fetchRoomStats).mockResolvedValue(null as unknown as RoomStats);
            const event =
                tab === "media"
                    ? image("$i1", "a.jpg")
                    : mkMessage({
                          event: true,
                          room: roomId,
                          user: "@alice:example.org",
                          msg: "look at https://example.org/x",
                      });
            room.addLiveEvents([event], { addToState: true });
            const loader = new SharedMediaLoader(client, room);
            const real = loader.state.bind(loader);
            vi.spyOn(loader, "state").mockImplementation((t) => ({ ...real(t), ...over }));
            return render(
                <MatrixClientContext.Provider value={client}>
                    <SharedMediaPane loader={loader} tab={tab} />
                </MatrixClientContext.Provider>,
            );
        }

        it("shows skeleton tiles and no spinner", async () => {
            renderLoading("media", { loading: true, done: false });
            await flushPromises();
            expect(document.querySelector(".mx_Spinner")).not.toBeInTheDocument();
            expect(screen.getByTestId("shared-media-skeleton")).toBeInTheDocument();
            // As many as a row of the grid holds, so they are the size of the tiles that replace them.
            expect(document.querySelectorAll(".mx_SharedMedia_skeletonTiles .mx_SharedMedia_pending")).toHaveLength(3);
        });

        it("shows a skeleton row, not a spinner, in the list tabs", async () => {
            renderLoading("links", { loading: true, done: false });
            await flushPromises();
            expect(document.querySelector(".mx_Spinner")).not.toBeInTheDocument();
            expect(screen.getByTestId("shared-media-skeleton")).toBeInTheDocument();
        });

        it("shows nothing at the end once there is nothing more to load", async () => {
            renderLoading("media", { loading: false, done: true });
            await flushPromises();
            expect(document.querySelector(".mx_SharedMedia_more")).not.toBeInTheDocument();
            expect(screen.queryByTestId("shared-media-skeleton")).not.toBeInTheDocument();
            expect(document.querySelector(".mx_Spinner")).not.toBeInTheDocument();
        });
    });

    describe("a drag that is interrupted", () => {
        async function startDrag() {
            renderTab("media", [image("$i1", "a.jpg"), image("$i2", "b.jpg"), image("$i3", "c.jpg")]);
            await flushPromises();
            const items = document.querySelectorAll<HTMLElement>(".mx_SharedMedia_gridItem");
            fireEvent.click(items[0], { ctrlKey: true });
            fireEvent.pointerDown(items[1], { pointerType: "mouse" });
            fireEvent.pointerEnter(items[2]);
            expect(screen.getByText("3 selected")).toBeInTheDocument();
            return items;
        }

        it.each([
            ["the window losing focus", () => fireEvent.blur(window)],
            ["the pointer being cancelled", () => fireEvent.pointerCancel(window)],
            ["the pointer being taken away", () => fireEvent(window, new Event("lostpointercapture"))],
            [
                "the page being hidden",
                () => {
                    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
                    fireEvent(document, new Event("visibilitychange"));
                },
            ],
        ])("ends on %s, so what the pointer crosses afterwards is left alone", async (_name, interrupt) => {
            const items = await startDrag();
            act(() => {
                interrupt();
            });
            fireEvent.pointerEnter(items[1]);
            expect(screen.getByText("3 selected")).toBeInTheDocument();
        });

        it("does not swallow the next click, which no drag is behind", async () => {
            const items = await startDrag();
            act(() => void fireEvent.blur(window));
            fireEvent.click(items[2]);
            expect(screen.getByText("2 selected")).toBeInTheDocument();
        });

        it("does not start a selection from a hold that was interrupted", async () => {
            vi.useFakeTimers();
            try {
                renderTab("media", [image("$i1", "a.jpg")]);
                await act(async () => {
                    await vi.runOnlyPendingTimersAsync();
                });
                const item = document.querySelector<HTMLElement>(".mx_SharedMedia_gridItem")!;
                fireEvent.pointerDown(item);
                act(() => void fireEvent.blur(window));
                act(() => {
                    vi.advanceTimersByTime(500);
                });
                expect(screen.queryByText("1 selected")).not.toBeInTheDocument();
            } finally {
                vi.useRealTimers();
            }
        });
    });

    describe("the floating bars", () => {
        it("finds where the bars end from their own sticky offset and height", () => {
            const box = document.createElement("div");
            document.body.append(box);
            const bar = (top: string, height: number): void => {
                const el = document.createElement("div");
                el.setAttribute("data-mx-floating", "");
                el.style.top = top;
                Object.defineProperty(el, "offsetHeight", { value: height });
                box.append(el);
            };
            expect(floatingFloor(box)).toBe(0);
            bar("8px", 40);
            bar("56px", 40);
            // The lowest bar's bottom, and a little room under it.
            expect(floatingFloor(box)).toBe(100);
            expect(floatingFloor(null)).toBe(0);
            box.remove();
        });
    });

    describe("right-clicking an item", () => {
        it("offers what the selection bar offers, for that one message", async () => {
            renderTab("media", [image("$i1", "a.jpg"), image("$i2", "b.jpg")]);
            await flushPromises();
            const items = document.querySelectorAll<HTMLElement>(".mx_SharedMedia_gridItem");
            fireEvent.contextMenu(items[0], { clientX: 20, clientY: 30 });
            expect(screen.getByRole("menuitem", { name: "Open" })).toBeInTheDocument();
            expect(screen.getByRole("menuitem", { name: "Show in chat" })).toBeInTheDocument();
            expect(screen.getByRole("menuitem", { name: "Download" })).toBeInTheDocument();
            expect(screen.getByRole("menuitem", { name: "Forward" })).toBeInTheDocument();
            expect(screen.getByRole("menuitem", { name: "Select" })).toBeInTheDocument();

            fireEvent.click(screen.getByRole("menuitem", { name: "Select" }));
            expect(screen.queryByRole("menuitem", { name: "Select" })).not.toBeInTheDocument();
            expect(screen.getByText("1 selected")).toBeInTheDocument();
            expect(items[0]).toHaveAttribute("aria-pressed", "true");
        });

        it("does not open over the selection that holding a finger down starts", async () => {
            renderTab("media", [image("$i1", "a.jpg")]);
            await flushPromises();
            const item = document.querySelector<HTMLElement>(".mx_SharedMedia_gridItem")!;
            fireEvent.pointerDown(item, { pointerType: "touch" });
            fireEvent.contextMenu(item);
            expect(screen.queryByRole("menuitem", { name: "Show in chat" })).not.toBeInTheDocument();
        });

        it("is offered on a row of the list tabs too", async () => {
            renderTab("music", [audio("$a", "song.mp3")]);
            await flushPromises();
            fireEvent.contextMenu(screen.getByText("song.mp3"));
            expect(screen.getByRole("menuitem", { name: "Show in chat" })).toBeInTheDocument();
            expect(screen.queryByRole("menuitem", { name: "Open" })).not.toBeInTheDocument();
        });
    });

    describe("when the panel or the window is resized", () => {
        let box: { width: number; height: number; scrollHeight: number; bottom: number };
        let observers: Array<() => void>;

        beforeEach(() => {
            box = { width: 300, height: 1000, scrollHeight: 5000, bottom: 1000 };
            observers = [];
            vi.stubGlobal(
                "ResizeObserver",
                class {
                    public constructor(cb: () => void) {
                        observers.push(cb);
                    }
                    public observe(): void {}
                    public unobserve(): void {}
                    public disconnect(): void {}
                },
            );
            vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => box.width);
            vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => box.height);
            vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(() => box.scrollHeight);
            vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
                () =>
                    ({
                        top: 0,
                        left: 0,
                        right: box.width,
                        bottom: box.bottom,
                        width: box.width,
                        height: box.height,
                    }) as DOMRect,
            );
        });

        afterEach(() => {
            vi.unstubAllGlobals();
            vi.restoreAllMocks();
        });

        function renderScrolling(events: MatrixEvent[]) {
            room.addLiveEvents(events, { addToState: true });
            const loader = new SharedMediaLoader(client, room);
            return render(
                <MatrixClientContext.Provider value={client}>
                    <div style={{ overflowY: "auto" }}>
                        <SharedMediaPane loader={loader} tab="media" />
                    </div>
                </MatrixClientContext.Provider>,
            );
        }

        it("steps the thumbnail size with the width of a cell", () => {
            expect(thumbSizeFor(100, 1)).toBe(160);
            expect(thumbSizeFor(161, 1)).toBe(320);
            expect(thumbSizeFor(100, 2)).toBe(320);
        });

        it("asks for sharper thumbnails once the panel is dragged wider, and not again on every pixel", async () => {
            Object.assign(client, { mxcUrlToHttp: vi.fn((_mxc: string, w: number) => `https://media.example/${w}`) });
            renderScrolling([image("$i1", "a.jpg")]);
            await flushPromises();
            const src = (): string | null =>
                document.querySelector(".mx_SharedMedia_gridItem img")!.getAttribute("src");
            expect(src()).toContain("/160");

            box.width = 900;
            act(() => observers.forEach((cb) => cb()));
            expect(src()).toContain("/320");

            box.width = 905;
            act(() => observers.forEach((cb) => cb()));
            expect(src()).toContain("/320");

            box.width = 300;
            act(() => observers.forEach((cb) => cb()));
            expect(src()).toContain("/160");
        });

        it("hangs the scrubber below a floating bar instead of under it", async () => {
            const before = UIStore.instance.windowHeight;
            vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(() => 40);
            try {
                UIStore.instance.windowHeight = 1000;
                room.addLiveEvents([image("$i1", "a.jpg")], { addToState: true });
                const loader = new SharedMediaLoader(client, room);
                render(
                    <MatrixClientContext.Provider value={client}>
                        <div style={{ overflowY: "auto" }}>
                            <div data-mx-floating style={{ top: "56px" }} />
                            <SharedMediaPane loader={loader} tab="media" />
                        </div>
                    </MatrixClientContext.Provider>,
                );
                await flushPromises();
                const dock = document.querySelector<HTMLElement>(".mx_SharedMedia_column")!;
                // The bar ends 96px down, and the track keeps 4px clear of it.
                expect(dock.style.getPropertyValue("--SharedMedia-floor")).toBe("100px");
                expect(document.querySelector<HTMLElement>(".mx_SharedMedia_scrubber")!.style.height).toBe("900px");
            } finally {
                UIStore.instance.windowHeight = before;
            }
        });

        it("shortens the scrubber's track when the window gets shorter, though the box is the same size", async () => {
            const before = UIStore.instance.windowHeight;
            try {
                UIStore.instance.windowHeight = 800;
                renderScrolling([image("$i1", "a.jpg")]);
                await flushPromises();
                const track = (): string =>
                    document.querySelector<HTMLElement>(".mx_SharedMedia_scrubber")!.style.height;
                // The box reaches 200px past the bottom of the screen, which the track must stop short of.
                expect(track()).toBe("800px");

                UIStore.instance.windowHeight = 600;
                act(() => {
                    UIStore.instance.emit(UI_EVENTS.Resize, []);
                });
                expect(track()).toBe("600px");
            } finally {
                UIStore.instance.windowHeight = before;
            }
        });
    });
});
