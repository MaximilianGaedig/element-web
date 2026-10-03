/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { render, screen, waitFor } from "test-utils-rtl";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventStatus, type MatrixClient, MatrixEvent, PendingEventOrdering, Room } from "matrix-js-sdk/src/matrix";
import type { TimelineItem } from "@element-hq/web-shared-components";
import { createTestClient, mkMessage, TestSDKContext } from "test-utils";

import { NewTimelinePanel } from "./NewTimelinePanel";
import { Layout } from "../../settings/enums/Layout";
import EditorStateTransfer from "../../utils/EditorStateTransfer";
import MatrixClientContext from "../../contexts/MatrixClientContext";
import { SDKContext } from "../../contexts/SDKContext";

const ROOM_ID = "!room:example.org";
const USER_ID = "@alice:example.org";

// The virtualised TimelineView needs real layout, which this environment has none
// of, and it has its own tests in shared-components. Stand in a stub that simply
// draws every row, so these tests cover how this panel renders each kind of row.
const { rowsRendered } = vi.hoisted(() => ({ rowsRendered: { current: [] as unknown[] } }));

vi.mock("@element-hq/web-shared-components", async () => {
    const actual = await vi.importActual<typeof import("@element-hq/web-shared-components")>(
        "@element-hq/web-shared-components",
    );
    return {
        ...actual,
        TimelineView: ({
            vm,
            renderItem,
            renderPlaceholder,
            animateNewMessages,
            paddingStart,
            paddingEnd,
        }: {
            paddingStart?: number;
            paddingEnd?: number;
            vm: { getSnapshot: () => { items: TimelineItem[] } };
            renderItem: (item: TimelineItem) => React.ReactNode;
            renderPlaceholder?: () => React.ReactNode;
            animateNewMessages?: boolean;
        }) => {
            const items = vm.getSnapshot().items;
            rowsRendered.current = items;
            return (
                <>
                    <div
                        data-testid="timeline-stub"
                        data-animates={String(!!animateNewMessages)}
                        data-padding={`${paddingStart}/${paddingEnd}`}
                    >
                        {items.map((item) => renderItem(item))}
                    </div>
                    <div data-testid="placeholder">{renderPlaceholder?.()}</div>
                </>
            );
        },
    };
});

// The view model has its own tests; here it only needs to hand the view a set of
// rows, so stand in a fake whose rows each test controls.
const { vmState } = vi.hoisted(() => ({
    // One snapshot object, replaced only by setRows: useSyncExternalStore compares
    // snapshots by identity, so handing back a fresh object each call would loop.
    vmState: {
        snapshot: {} as Record<string, unknown>,
        setRows(items: unknown[]) {
            this.snapshot = {
                items,
                atLiveEnd: true,
                pendingAnchor: null,
                highlightedEventId: null,
                isAtBottom: true,
                canJumpToReadMarker: false,
                numUnreadMessages: 0,
                hasHighlights: false,
                unreadMentions: 0,
                unreadReactions: 0,
            };
        },
    },
}));

vi.mock("../../viewmodels/room/timeline/RoomTimelineViewModel", () => ({
    RoomTimelineViewModel: class {
        public start = (): void => {};
        public setActive = (): void => {};
        public dispose = (): void => {};
        public subscribe = (): (() => void) => (): void => {};
        public getSnapshot = (): Record<string, unknown> => vmState.snapshot;
    },
}));

// EventTile pulls in a large tree that isn't what these tests are about; record
// what the row asked for instead.
const { tileProps } = vi.hoisted(() => ({ tileProps: { current: [] as Record<string, unknown>[] } }));

vi.mock("../views/rooms/LegacyEventTileAdapter", () => ({
    LegacyEventTileAdapter: (props: Record<string, unknown>) => {
        tileProps.current.push(props);
        return <div data-testid="event-row" />;
    },
}));

describe("<NewTimelinePanel />", () => {
    let client: MatrixClient;
    let room: Room;
    let event: MatrixEvent;

    const renderPanel = (props: Partial<React.ComponentProps<typeof NewTimelinePanel>> = {}) =>
        render(
            <MatrixClientContext.Provider value={client}>
                <SDKContext.Provider value={new TestSDKContext()}>
                    <NewTimelinePanel room={room} {...props} />
                </SDKContext.Provider>
            </MatrixClientContext.Provider>,
        );

    /** Set the rows the timeline is given to draw. */
    const withItems = (items: TimelineItem[]): void => {
        vmState.setRows(items);
    };

    beforeEach(() => {
        vi.restoreAllMocks();
        tileProps.current = [];
        rowsRendered.current = [];
        vmState.setRows([]);
        client = createTestClient();
        room = new Room(ROOM_ID, client, USER_ID, { pendingEventOrdering: PendingEventOrdering.Detached });
        vi.spyOn(client, "getRoom").mockReturnValue(room);
        event = mkMessage({ room: ROOM_ID, user: USER_ID, msg: "hello", event: true });
        room.getUnfilteredTimelineSet().addLiveEvent(event, { addToState: false });
    });

    it("draws a row for a message in the room", () => {
        withItems([{ key: event.getId()!, kind: "event", continuation: false, lastInSection: true } as TimelineItem]);

        renderPanel();

        expect(screen.getByTestId("event-row")).toBeInTheDocument();
        expect(tileProps.current[0].mxEvent).toBe(event);
    });

    /*
     * The view model listed a message that had failed to send, and the row for it was empty: the chat
     * carried the "not sent" mark and showed nothing that was not sent.
     */
    it("draws a row for a message of ours that has not gone out, which the room holds apart", () => {
        const unsent = new MatrixEvent({
            type: "m.room.message",
            content: { msgtype: "m.text", body: "did this go out?" },
            event_id: `~${ROOM_ID}:m1.0`,
            sender: USER_ID,
            room_id: ROOM_ID,
            origin_server_ts: 2,
        });
        unsent.setStatus(EventStatus.NOT_SENT);
        room.addPendingEvent(unsent, "m1.0");
        // Held apart: looking it up as a message of the room finds nothing.
        expect(room.findEventById(unsent.getId()!)).toBeUndefined();
        withItems([
            { key: event.getId()!, kind: "event", continuation: false, lastInSection: false } as TimelineItem,
            { key: unsent.getId()!, kind: "event", continuation: false, lastInSection: true } as TimelineItem,
        ]);

        renderPanel();

        expect(screen.getAllByTestId("event-row")).toHaveLength(2);
        expect(tileProps.current.map((props) => props.mxEvent)).toEqual([event, unsent]);
    });

    it("skips a row whose event is no longer in the room instead of failing", () => {
        withItems([{ key: "$gone", kind: "event", continuation: false, lastInSection: true } as TimelineItem]);

        renderPanel();

        // The row is simply absent; rendering the rest of the timeline still succeeded.
        expect(screen.queryByTestId("event-row")).toBeNull();
        expect(screen.getByTestId("timeline-stub")).toBeInTheDocument();
    });

    it('labels the read marker "New"', () => {
        withItems([{ key: "$marker", kind: "read-marker" } as TimelineItem]);

        renderPanel();

        expect(screen.getByText("New")).toBeInTheDocument();
    });

    it("announces the loading row to screen readers", () => {
        withItems([{ key: "loading", kind: "loading" } as TimelineItem]);

        renderPanel();

        expect(screen.getByRole("progressbar")).toBeInTheDocument();
    });

    it("draws empty bubbles for the loading row in the Telegram layout, still announced as loading", () => {
        withItems([{ key: "loading", kind: "loading" } as TimelineItem]);

        renderPanel({ layout: Layout.Bubble });

        const row = screen.getByRole("progressbar");
        expect(row).toHaveClass("mx_NewTimelinePanel_loadingMessages");
        expect(row.querySelectorAll(".mx_TgMessagesSkeleton_bubble")).toHaveLength(4);
    });

    it("gives the Telegram layout a conversation of empty bubbles to open on, and new messages that animate", () => {
        withItems([]);

        renderPanel({ layout: Layout.Bubble });

        const placeholder = screen.getByTestId("placeholder");
        expect(placeholder.querySelector(".mx_TgMessagesSkeleton_opening")).not.toBeNull();
        expect(placeholder.querySelectorAll(".mx_TgMessagesSkeleton_bubble")).toHaveLength(20);
        expect(screen.getByTestId("timeline-stub")).toHaveAttribute("data-animates", "true");
    });

    it("keeps a gap between the messages and what floats over them, and none where nothing floats", async () => {
        withItems([]);
        // What the chrome has measured, as the panel reads it off the room body
        const measured: Record<string, string> = { "--tg-header-block": "56px" };
        vi.spyOn(window, "getComputedStyle").mockImplementation(
            () => ({ getPropertyValue: (name: string) => measured[name] ?? "" }) as CSSStyleDeclaration,
        );
        const { container } = render(
            <div className="mx_RoomView_body">
                <MatrixClientContext.Provider value={client}>
                    <SDKContext.Provider value={new TestSDKContext()}>
                        <NewTimelinePanel room={room} />
                    </SDKContext.Provider>
                </MatrixClientContext.Provider>
            </div>,
        );

        // Nothing floats over the end yet: no composer, no gap
        expect(screen.getByTestId("timeline-stub")).toHaveAttribute("data-padding", "64/0");

        // The chrome writes the composer's height onto the room body as it measures it
        measured["--tg-composer-block"] = "60px";
        (container.firstElementChild as HTMLElement).style.setProperty("--tg-composer-block", "60px");
        await waitFor(() => expect(screen.getByTestId("timeline-stub")).toHaveAttribute("data-padding", "64/68"));
    });

    it("leaves the other layouts their spinner and their jump to a new message", () => {
        withItems([]);

        renderPanel();

        expect(screen.getByTestId("placeholder")).toBeEmptyDOMElement();
        expect(screen.getByTestId("timeline-stub")).toHaveAttribute("data-animates", "false");
    });

    it("labels a date separator the way the old timeline does", () => {
        withItems([{ key: "$sep", kind: "date-separator", ts: Date.now() } as TimelineItem]);

        renderPanel();

        // A relative label, from the shared DateSeparatorViewModel.
        expect(screen.getByText(/today/i)).toBeInTheDocument();
    });

    it("draws nothing for a gap, matching the old timeline", () => {
        withItems([{ key: "$gap", kind: "gap" } as TimelineItem]);

        renderPanel();

        expect(screen.getByTestId("timeline-stub")).toBeEmptyDOMElement();
    });

    it("falls back to the modern layout when IRC is selected", () => {
        withItems([{ key: event.getId()!, kind: "event", continuation: false, lastInSection: true } as TimelineItem]);

        renderPanel({ layout: Layout.IRC });

        expect(tileProps.current[0].layout).toBe(Layout.Group);
    });

    it("passes the message layout through unchanged", () => {
        withItems([{ key: event.getId()!, kind: "event", continuation: false, lastInSection: true } as TimelineItem]);

        renderPanel({ layout: Layout.Bubble });

        expect(tileProps.current[0].layout).toBe(Layout.Bubble);
    });

    it("hides sender avatars and names in a one-to-one Telegram bubble timeline", () => {
        withItems([{ key: event.getId()!, kind: "event", continuation: false, lastInSection: true } as TimelineItem]);

        const { container } = renderPanel({ layout: Layout.Bubble });

        expect(tileProps.current[0]).toMatchObject({
            hideAvatar: true,
            hideSender: true,
            telegramBubbles: true,
            telegramTicks: true,
        });
        expect(container.querySelector(".mx_NewTimelinePanel")).toHaveClass("mx_MessagePanel_noAvatars");
    });

    it("keeps sender avatars in a group bubble timeline", () => {
        vi.spyOn(room, "getInvitedAndJoinedMemberCount").mockReturnValue(3);
        withItems([{ key: event.getId()!, kind: "event", continuation: false, lastInSection: true } as TimelineItem]);

        const { container } = renderPanel({ layout: Layout.Bubble });

        expect(tileProps.current[0]).toMatchObject({ hideAvatar: true, hideSender: false });
        expect(container.querySelectorAll(".mx_NewTimelinePanel_senderAvatar")).toHaveLength(1);
        expect(container.querySelector(".mx_NewTimelinePanel")).not.toHaveClass("mx_MessagePanel_noAvatars");
    });

    it("shows one avatar at the end of an incoming sender run", () => {
        vi.spyOn(room, "getInvitedAndJoinedMemberCount").mockReturnValue(3);
        const other = mkMessage({ room: ROOM_ID, user: USER_ID, msg: "next", event: true });
        room.getUnfilteredTimelineSet().addLiveEvent(other, { addToState: false });
        withItems([
            { key: event.getId()!, kind: "event", continuation: false, lastInSection: false } as TimelineItem,
            { key: other.getId()!, kind: "event", continuation: true, lastInSection: true } as TimelineItem,
        ]);

        const { container } = renderPanel({ layout: Layout.Bubble });

        const messages = container.querySelectorAll(".mx_NewTimelinePanel_senderMessage");
        expect(messages).toHaveLength(2);
        expect(messages[0].querySelector(".mx_NewTimelinePanel_senderAvatar")).toBeNull();
        expect(messages[1].querySelector(".mx_NewTimelinePanel_senderAvatar")).not.toBeNull();
    });

    it("gives our own messages no avatar in a group bubble timeline, but keeps read receipt avatars", () => {
        vi.spyOn(room, "getInvitedAndJoinedMemberCount").mockReturnValue(3);
        const mine = mkMessage({ room: ROOM_ID, user: client.getSafeUserId(), msg: "mine", event: true });
        room.getUnfilteredTimelineSet().addLiveEvent(mine, { addToState: false });
        withItems([{ key: mine.getId()!, kind: "event", continuation: false, lastInSection: true } as TimelineItem]);

        renderPanel({ layout: Layout.Bubble });

        expect(tileProps.current[0]).toMatchObject({ hideAvatar: true, telegramTicks: false });
    });

    it("gives each message the read receipts of those who read up to it, in a group", () => {
        vi.spyOn(room, "getInvitedAndJoinedMemberCount").mockReturnValue(3);
        const reader = "@bob:example.org";
        room.addReceipt(
            new MatrixEvent({
                type: "m.receipt",
                room_id: ROOM_ID,
                content: { [event.getId()!]: { "m.read": { [reader]: { ts: 42 } } } },
            }),
        );
        withItems([{ key: event.getId()!, kind: "event", continuation: false, lastInSection: true } as TimelineItem]);

        renderPanel({ layout: Layout.Bubble });

        expect(tileProps.current[0]).toMatchObject({ showReadReceipts: true });
        expect(tileProps.current[0].readReceipts).toEqual([expect.objectContaining({ userId: reader, ts: 42 })]);
    });

    it("gives the edit state only to the message being edited", () => {
        const other = mkMessage({ room: ROOM_ID, user: USER_ID, msg: "other", event: true });
        room.getUnfilteredTimelineSet().addLiveEvent(other, { addToState: false });
        const editState = new EditorStateTransfer(event);
        withItems([
            { key: event.getId()!, kind: "event", continuation: false, lastInSection: true } as TimelineItem,
            { key: other.getId()!, kind: "event", continuation: false, lastInSection: true } as TimelineItem,
        ]);

        renderPanel({ editState });

        expect(tileProps.current[0].editState).toBe(editState);
        expect(tileProps.current[1].editState).toBeUndefined();
    });

    it("hides the panel without unmounting it", () => {
        withItems([]);

        const { container } = renderPanel({ hidden: true });

        expect(container.querySelector(".mx_NewTimelinePanel")).toHaveClass("mx_NewTimelinePanel_hidden");
        expect(screen.getByTestId("timeline-stub")).toBeInTheDocument();
    });

    it("lets tiles look up relations, so reactions can render", () => {
        withItems([{ key: event.getId()!, kind: "event", continuation: false, lastInSection: true } as TimelineItem]);

        renderPanel();

        const getRelationsForEvent = tileProps.current[0].getRelationsForEvent as (
            id: string,
            rel: string,
            type: string,
        ) => unknown;
        expect(typeof getRelationsForEvent).toBe("function");
        // Nothing has reacted, so there are no relations to find — but the lookup
        // has to reach the room without throwing.
        expect(getRelationsForEvent(event.getId()!, "m.annotation", "m.reaction")).toBeUndefined();
    });
});
