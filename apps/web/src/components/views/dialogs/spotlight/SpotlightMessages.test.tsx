/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    type ISearchResults,
    type MatrixClient,
    type MatrixEvent,
    type Room,
    type RoomMember,
} from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";
import { act, fireEvent, render, screen } from "test-utils-rtl";
import { flushPromisesWithFakeTimers, mkEvent, mkRoom, stubClient } from "test-utils";

import SpotlightDialog from "./SpotlightDialog";
import { Filter } from "./Filter";
import { MatrixClientPeg } from "../../../../MatrixClientPeg";
import DMRoomMap from "../../../../utils/DMRoomMap";
import defaultDispatcher from "../../../../dispatcher/dispatcher";
import { Action } from "../../../../dispatcher/actions";
import eventSearch, { searchPagination } from "../../../../Searching";
import { ScreenSize, useScreenSize } from "../../../../utils/telegram/tgLayout/mediaSizes";

vi.useFakeTimers({ shouldAdvanceTime: true });

vi.mock("../../../../utils/Feedback");
vi.mock("../../../../dispatcher/dispatcher", () => ({
    default: { register: vi.fn(), dispatch: vi.fn() },
}));
vi.mock("../../../../Searching", () => ({
    default: vi.fn(),
    searchPagination: vi.fn(),
}));
vi.mock("../../../../utils/telegram/tgLayout/mediaSizes", async () => ({
    // @ts-ignore
    ...(await vi.importActual("../../../../utils/telegram/tgLayout/mediaSizes")),
    useScreenSize: vi.fn(),
}));

const DM_ID = "!dm:example.com";
const GROUP_ID = "!group:example.com";

describe("Spotlight messages", () => {
    let client: MatrixClient;
    let group: Room;
    let dm: Room;

    function hit(id: string, roomId: string, body: string, extra: Record<string, unknown> = {}, ts = Date.now()): any {
        const event = mkEvent({
            id,
            type: "m.room.message",
            room: roomId,
            user: "@alice:example.com",
            content: { msgtype: "m.text", body, ...extra },
            ts,
            event: true,
        }) as MatrixEvent;
        return { rank: 1, context: { getEvent: () => event, getTimeline: () => [event], getOurEventIndex: () => 0 } };
    }

    function found(results: any[], next_batch?: string): ISearchResults {
        return { results, highlights: [], next_batch, count: results.length } as unknown as ISearchResults;
    }

    async function settle(): Promise<void> {
        await act(async () => {
            vi.advanceTimersByTime(400);
            await flushPromisesWithFakeTimers();
            await flushPromisesWithFakeTimers();
        });
    }

    beforeEach(() => {
        stubClient();
        client = MatrixClientPeg.safeGet();
        group = mkRoom(client, GROUP_ID);
        group.name = "Book club";
        dm = mkRoom(client, DM_ID);
        dm.name = "Alice";
        for (const room of [group, dm]) vi.mocked(room.getMyMembership).mockReturnValue(KnownMembership.Join);
        for (const room of [group, dm]) {
            vi.mocked(room.getMember).mockReturnValue({ name: "Alice" } as unknown as RoomMember);
        }
        vi.mocked(client.getVisibleRooms).mockReturnValue([group, dm]);
        vi.mocked(client.getRoom).mockImplementation((id) => (id === GROUP_ID ? group : id === DM_ID ? dm : null));
        vi.spyOn(DMRoomMap, "shared").mockReturnValue({
            getUserIdForRoomId: (id: string) => (id === DM_ID ? "@alice:example.com" : undefined),
        } as unknown as DMRoomMap);
        vi.mocked(useScreenSize).mockReturnValue(ScreenSize.large);
        vi.mocked(eventSearch).mockReset();
        vi.mocked(searchPagination).mockReset();
        vi.mocked(defaultDispatcher.dispatch).mockClear();
    });

    afterEach(() => {
        vi.clearAllTimers();
    });

    it("renders the handheld variant with Cancel and the filter tabs", async () => {
        vi.mocked(useScreenSize).mockReturnValue(ScreenSize.mobile);
        const onFinished = vi.fn();
        const { container } = render(<SpotlightDialog onFinished={onFinished} />);
        await settle();

        expect(container.querySelector(".mx_SpotlightDialog_handheld")).toBeInTheDocument();
        expect(screen.getByRole("tablist", { name: "Search filters" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
        expect(onFinished).toHaveBeenCalled();
    });

    it("is a panel rather than the handheld screen on a desktop: tabs instead of a list of filters, and a close button", async () => {
        const onFinished = vi.fn();
        render(<SpotlightDialog onFinished={onFinished} />);
        await settle();

        expect(document.querySelector(".mx_SpotlightDialog_handheld")).not.toBeInTheDocument();
        // Not held to a dialog's fixed width: the stylesheet sizes the centred panel by the handheld class.
        expect(document.querySelector(".mx_SpotlightDialog")).not.toHaveClass("mx_Dialog_fixedWidth");
        // Public spaces joins them only once the server says it can filter by room type, which this one does not.
        expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
            "All",
            "People",
            "Messages",
            "Public rooms",
        ]);
        expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "true");
        // The tabs are the filters: the old "Search for" list of them is gone.
        expect(document.querySelector(".mx_SpotlightDialog_otherSearches")).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Close" }));
        expect(onFinished).toHaveBeenCalled();
    });

    it("clears the query with the clear button and keeps the field focused", async () => {
        vi.mocked(eventSearch).mockResolvedValue(found([]));
        render(<SpotlightDialog initialText="dune" onFinished={vi.fn()} />);
        await settle();
        const input = screen.getByRole("textbox", { name: "Search" });

        fireEvent.click(screen.getByRole("button", { name: "Clear" }));

        expect(input).toHaveValue("");
        expect(input).toHaveFocus();
        expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
    });

    it("groups messages after the chats, with the chat, the sender and the match marked", async () => {
        vi.mocked(eventSearch).mockResolvedValue(found([hit("$1", GROUP_ID, "Next book: Dune is great")]));
        render(<SpotlightDialog initialText="dune" onFinished={vi.fn()} />);
        await settle();

        const heading = screen.getByRole("heading", { name: "Messages" });
        const group = heading.closest("[role=group]")!;
        expect(group).toHaveTextContent("Book club");
        expect(group).toHaveTextContent("Alice:");
        expect(group.querySelector("mark")).toHaveTextContent("Dune");
        expect(eventSearch).toHaveBeenCalledWith(client, "dune", undefined, expect.any(AbortSignal));
    });

    it("opens the chat at the message when a message result is pressed", async () => {
        const onFinished = vi.fn();
        vi.mocked(eventSearch).mockResolvedValue(found([hit("$42", GROUP_ID, "dune")]));
        render(<SpotlightDialog initialText="dune" onFinished={onFinished} />);
        await settle();

        fireEvent.click(document.getElementById("mx_SpotlightDialog_button_message_$42")!);

        expect(defaultDispatcher.dispatch).toHaveBeenCalledWith(
            expect.objectContaining({
                action: Action.ViewRoom,
                room_id: GROUP_ID,
                event_id: "$42",
                highlighted: true,
            }),
        );
        expect(onFinished).toHaveBeenCalled();
    });

    it("shows only the first few hits among the chats and 'Show all' turns it into the whole view", async () => {
        const many = ["$1", "$2", "$3", "$4", "$5"].map((id) => hit(id, GROUP_ID, `dune ${id}`));
        vi.mocked(eventSearch).mockResolvedValue(found(many));
        render(<SpotlightDialog initialText="dune" onFinished={vi.fn()} />);
        await settle();

        expect(document.querySelectorAll(".mx_SpotlightDialog_message")).toHaveLength(3);
        fireEvent.click(screen.getByRole("button", { name: "Show all" }));
        await settle();

        expect(document.querySelectorAll(".mx_SpotlightDialog_message")).toHaveLength(5);
        expect(screen.getByRole("tab", { name: "Messages" })).toHaveAttribute("aria-selected", "true");
        expect(screen.getByRole("button", { name: "Media" })).toBeInTheDocument();
        // The whole list says how many matched, as Telegram's does.
        expect(screen.getByRole("heading", { name: "5 messages found" })).toBeInTheDocument();
    });

    it("says so, and what to try, when no message matched", async () => {
        vi.mocked(eventSearch).mockResolvedValue(found([]));
        render(<SpotlightDialog initialText="dune" initialFilter={Filter.Messages} onFinished={vi.fn()} />);
        await settle();

        expect(screen.getByText("No messages found")).toBeInTheDocument();
        expect(screen.getByText("Try other words, or turn off a filter.")).toBeInTheDocument();
        expect(screen.queryByRole("heading", { name: "Messages" })).not.toBeInTheDocument();
    });

    it("opens as the messages view when asked for the Messages filter", async () => {
        vi.mocked(eventSearch).mockResolvedValue(found([]));
        render(<SpotlightDialog initialFilter={Filter.Messages} onFinished={vi.fn()} />);
        await settle();

        expect(screen.getByText("Type to search the messages in all your chats")).toBeInTheDocument();
        expect(eventSearch).not.toHaveBeenCalled();
    });

    describe("filters", () => {
        beforeEach(() => {
            vi.mocked(eventSearch).mockResolvedValue(
                found([
                    hit("$text", GROUP_ID, "dune notes"),
                    hit("$photo", GROUP_ID, "dune.png", { msgtype: "m.image" }),
                    hit("$dm", DM_ID, "dune in a dm"),
                    hit("$old", GROUP_ID, "dune ages ago", {}, Date.now() - 40 * 24 * 60 * 60 * 1000),
                ]),
            );
        });

        const shown = (): string[] =>
            Array.from(document.querySelectorAll(".mx_SpotlightDialog_message")).map((el) =>
                el.id.replace("mx_SpotlightDialog_button_message_", ""),
            );

        it("narrows by kind", async () => {
            render(<SpotlightDialog initialText="dune" initialFilter={Filter.Messages} onFinished={vi.fn()} />);
            await settle();
            expect(shown()).toEqual(["$text", "$photo", "$dm", "$old"]);

            fireEvent.click(screen.getByRole("button", { name: "Media" }));
            expect(shown()).toEqual(["$photo"]);

            // Pressed again, it is off.
            fireEvent.click(screen.getByRole("button", { name: "Media" }));
            expect(shown()).toHaveLength(4);
        });

        it("narrows by chat type and by date", async () => {
            render(<SpotlightDialog initialText="dune" initialFilter={Filter.Messages} onFinished={vi.fn()} />);
            await settle();

            fireEvent.click(screen.getByRole("button", { name: "Direct" }));
            expect(shown()).toEqual(["$dm"]);
            fireEvent.click(screen.getByRole("button", { name: "Direct" }));

            fireEvent.click(screen.getByRole("button", { name: "Past month" }));
            expect(shown()).toEqual(["$text", "$photo", "$dm"]);
        });
    });

    it("keeps the place in the list when the next page arrives as it is scrolled to its end", async () => {
        // The list asks for the next page when its end comes into view: hold on to that so the test can scroll there.
        let reachEnd: (() => void) | undefined;
        vi.stubGlobal(
            "IntersectionObserver",
            class {
                public constructor(callback: IntersectionObserverCallback) {
                    reachEnd = () => callback([{ isIntersecting: true } as IntersectionObserverEntry], this as any);
                }
                public observe(): void {}
                public disconnect(): void {}
            },
        );
        const results = found(
            ["$1", "$2", "$3", "$4"].map((id) => hit(id, GROUP_ID, `dune ${id}`)),
            "more",
        );
        vi.mocked(eventSearch).mockResolvedValue(results);
        vi.mocked(searchPagination).mockImplementation(async () => {
            results.results.push(...["$5", "$6"].map((id) => hit(id, GROUP_ID, `dune ${id}`)));
            results.next_batch = undefined;
            return results;
        });
        const scrolledTo = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
        try {
            render(<SpotlightDialog initialText="dune" initialFilter={Filter.Messages} onFinished={vi.fn()} />);
            await settle();
            const input = screen.getByRole("textbox", { name: "Search" });
            expect(input).toHaveAttribute("aria-activedescendant", "mx_SpotlightDialog_button_message_$1");

            // Down to the last hit, then its end comes into view and the next page is fetched.
            for (let i = 0; i < 3; i++) fireEvent.keyDown(input, { key: "ArrowDown" });
            expect(input).toHaveAttribute("aria-activedescendant", "mx_SpotlightDialog_button_message_$4");
            scrolledTo.mockClear();
            act(() => reachEnd!());
            await settle();

            expect(searchPagination).toHaveBeenCalled();
            expect(document.getElementById("mx_SpotlightDialog_button_message_$6")).toBeInTheDocument();
            // Neither the selection nor the scroll position goes back to the first hit.
            expect(input).toHaveAttribute("aria-activedescendant", "mx_SpotlightDialog_button_message_$4");
            expect(scrolledTo.mock.contexts).not.toContain(
                document.getElementById("mx_SpotlightDialog_button_message_$1"),
            );
        } finally {
            scrolledTo.mockRestore();
            vi.unstubAllGlobals();
        }
    });

    it("asks for the next page when a filter leaves the first one nearly empty", async () => {
        vi.mocked(eventSearch).mockResolvedValue(found([hit("$text", GROUP_ID, "dune")], "more"));
        const results = found([hit("$text", GROUP_ID, "dune")], "more");
        vi.mocked(eventSearch).mockResolvedValue(results);
        vi.mocked(searchPagination).mockImplementation(async () => {
            results.results.push(hit("$photo", GROUP_ID, "dune.png", { msgtype: "m.image" }));
            results.next_batch = undefined;
            return results;
        });
        render(<SpotlightDialog initialText="dune" initialFilter={Filter.Messages} onFinished={vi.fn()} />);
        await settle();

        fireEvent.click(screen.getByRole("button", { name: "Media" }));
        await settle();

        expect(searchPagination).toHaveBeenCalled();
        expect(document.getElementById("mx_SpotlightDialog_button_message_$photo")).toBeInTheDocument();
    });
});
