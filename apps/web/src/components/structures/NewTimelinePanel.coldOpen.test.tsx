/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

/*
 * What opening a room that is not already on screen waits for.
 *
 * The panel is mounted with the real view model over a client whose history requests take a set
 * time on a fake clock, so each test can read off (a) how long it was until the first message was
 * drawn and (b) which requests had been answered by then. The thing being protected: messages the
 * client already holds are drawn without any request to the server having come back.
 */

import React, { useEffect } from "react";
import { act, render } from "test-utils-rtl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    Direction,
    LOCAL_PAGINATION_PREFIX,
    type EventTimeline,
    type MatrixClient,
    type MatrixEvent,
    PendingEventOrdering,
    Room,
} from "matrix-js-sdk/src/matrix";
import type { TimelineItem, TimelineViewModel } from "@element-hq/web-shared-components";
import { createTestClient, mkMessage, TestSDKContext } from "test-utils";

import { NewTimelinePanel } from "./NewTimelinePanel";
import MatrixClientContext from "../../contexts/MatrixClientContext";
import { SDKContext } from "../../contexts/SDKContext";

const ROOM_ID = "!room:example.org";
const USER_ID = "@alice:example.org";

/** How long the server takes to answer, and how long a read of the browser's own store takes. */
const NETWORK_MS = 300;
const STORE_MS = 5;

// The virtualised view needs real layout. Stand in one that draws every row and, as the real one
// does once the first rows are placed, reports that the anchor was reached.
vi.mock("@element-hq/web-shared-components", async () => {
    const actual = await vi.importActual<typeof import("@element-hq/web-shared-components")>(
        "@element-hq/web-shared-components",
    );
    return {
        ...actual,
        TimelineView: ({
            vm,
            renderItem,
        }: {
            vm: TimelineViewModel;
            renderItem: (item: TimelineItem) => React.ReactNode;
        }) => {
            const { items, pendingAnchor } = actual.useViewModel(vm);
            useEffect(() => {
                if (items.length > 0 && pendingAnchor) vm.onAnchorReached();
            }, [vm, items.length, pendingAnchor]);
            return <div data-testid="timeline-stub">{items.map((item) => renderItem(item))}</div>;
        },
    };
});

// The tile's own tree is not what is being timed.
vi.mock("../views/rooms/LegacyEventTileAdapter", () => ({
    LegacyEventTileAdapter: ({ mxEvent }: { mxEvent: MatrixEvent }) => (
        <div data-testid="event-row" data-event-id={mxEvent.getId()} />
    ),
}));

interface RequestRecord {
    /** What was asked for: the endpoint, or the store read. */
    what: string;
    startedAt: number;
    /** Unset while the request is still out. */
    answeredAt?: number;
}

describe("<NewTimelinePanel /> opening a room", () => {
    let client: MatrixClient;
    let room: Room;
    let requests: RequestRecord[];
    let openedAt: number;
    let nextId: number;

    const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

    const messages = (count: number): MatrixEvent[] =>
        Array.from({ length: count }, () => {
            const n = nextId++;
            // Spaced out so that no two are one sender's run: every message is a full row.
            return mkMessage({ room: ROOM_ID, user: USER_ID, msg: `message ${n}`, event: true, id: `$m${n}`, ts: n });
        });

    /** What sync left in memory: the room's latest events, oldest first. */
    const inMemory = (events: MatrixEvent[]): void => {
        const timelineSet = room.getUnfilteredTimelineSet();
        for (const event of events) timelineSet.addLiveEvent(event, { addToState: false });
    };

    /**
     * Older history, behind the live timeline: first whatever the browser's store kept back at
     * startup (a trimmed replay), then what only the server has.
     */
    const olderHistory = ({ stored = 0, onServer = 0 }: { stored?: number; onServer?: number }): void => {
        // Oldest first, so the server's part is made before the stored part.
        const serverEvents = messages(onServer);
        const storedEvents = messages(stored);
        const live = room.getLiveTimeline();
        const serverToken = onServer > 0 ? "t-server" : null;
        live.setPaginationToken(stored > 0 ? LOCAL_PAGINATION_PREFIX + "$first" : serverToken, Direction.Backward);

        vi.mocked(client.paginateEventTimeline).mockImplementation(async (timeline: EventTimeline) => {
            const token = timeline.getPaginationToken(Direction.Backward);
            const fromStore = !!token?.startsWith(LOCAL_PAGINATION_PREFIX);
            const record: RequestRecord = {
                what: fromStore ? "store: stored timeline" : "GET /rooms/{roomId}/messages",
                startedAt: Date.now() - openedAt,
            };
            requests.push(record);
            await sleep(fromStore ? STORE_MS : NETWORK_MS);
            record.answeredAt = Date.now() - openedAt;
            // Newest first, as /messages answers a backwards request.
            const chunk = (fromStore ? storedEvents : serverEvents).slice().reverse();
            timeline.getTimelineSet().addEventsToTimeline(chunk, true, false, timeline, fromStore ? serverToken : null);
            return true;
        });
    };

    const mount = (): HTMLElement => {
        openedAt = Date.now();
        return render(
            <MatrixClientContext.Provider value={client}>
                <SDKContext.Provider value={new TestSDKContext()}>
                    <NewTimelinePanel room={room} />
                </SDKContext.Provider>
            </MatrixClientContext.Provider>,
        ).container;
    };

    const rows = (container: HTMLElement): number => container.querySelectorAll('[data-testid="event-row"]').length;

    /** Run the clock until a message is drawn; how long that took, on the fake clock. */
    const timeToFirstMessage = async (container: HTMLElement): Promise<number> => {
        await act(async () => {
            await vi.advanceTimersByTimeAsync(0);
        });
        while (rows(container) === 0) {
            if (Date.now() - openedAt > 10 * NETWORK_MS) throw new Error("no message was ever drawn");
            await act(async () => {
                await vi.advanceTimersByTimeAsync(1);
            });
        }
        return Date.now() - openedAt;
    };

    /** The requests that had been answered by now. */
    const answered = (): string[] => requests.filter((r) => r.answeredAt !== undefined).map((r) => r.what);

    const settle = async (): Promise<void> => {
        await act(async () => {
            await vi.advanceTimersByTimeAsync(5 * NETWORK_MS);
        });
    };

    beforeEach(() => {
        vi.useFakeTimers();
        localStorage.clear();
        requests = [];
        nextId = 1;
        client = createTestClient();
        room = new Room(ROOM_ID, client, USER_ID, {
            pendingEventOrdering: PendingEventOrdering.Detached,
            timelineSupport: true,
        });
        vi.spyOn(client, "getRoom").mockReturnValue(room);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("draws what sync left in memory before the server has answered anything", async () => {
        // A room this session has synced: the usual 20 latest events, the rest on the server.
        olderHistory({ onServer: 60 });
        inMemory(messages(20));

        const container = mount();
        const elapsed = await timeToFirstMessage(container);

        expect({ elapsed, answered: answered(), rows: rows(container) }).toEqual({
            elapsed: 0,
            answered: [],
            rows: 20,
        });

        // The history that makes the list long enough to scroll still arrives, behind the messages.
        await settle();
        expect(answered()).toEqual(["GET /rooms/{roomId}/messages"]);
        expect(rows(container)).toBe(80);
    });

    it("after a restart, draws a room from the browser's store without waiting for the server", async () => {
        // The first open after startup: the replay kept the room's last 3 events in memory and left
        // the rest of what was stored (fewer than fill a screen and more) in the store.
        olderHistory({ stored: 25, onServer: 60 });
        inMemory(messages(3));

        const container = mount();
        const elapsed = await timeToFirstMessage(container);

        expect({ elapsed, answered: answered(), rows: rows(container) }).toEqual({
            elapsed: STORE_MS,
            answered: ["store: stored timeline"],
            rows: 28,
        });

        await settle();
        expect(answered()).toEqual(["store: stored timeline", "GET /rooms/{roomId}/messages"]);
        expect(rows(container)).toBe(88);
    });

    it("asks the server for nothing when the store holds a screenful", async () => {
        olderHistory({ stored: 47, onServer: 60 });
        inMemory(messages(3));

        const container = mount();
        const elapsed = await timeToFirstMessage(container);

        expect({ elapsed, answered: answered(), rows: rows(container) }).toEqual({
            elapsed: STORE_MS,
            answered: ["store: stored timeline"],
            rows: 50,
        });

        await settle();
        expect(requests.map((r) => r.what)).toEqual(["store: stored timeline"]);
    });

    it("has the room's stored state in before its stored history is read", async () => {
        olderHistory({ stored: 25 });
        inMemory(messages(3));
        // The members a trimmed replay left in the store: history added to the timeline before them
        // would take its senders' names from a room that does not know them yet.
        let stateIsIn = false;
        Object.assign(client, {
            loadStoredRoomState: vi.fn(async () => {
                await sleep(STORE_MS);
                stateIsIn = true;
            }),
        });
        const readHistory = vi.mocked(client.paginateEventTimeline).getMockImplementation()!;
        const stateWasIn: boolean[] = [];
        vi.mocked(client.paginateEventTimeline).mockImplementation((...args) => {
            stateWasIn.push(stateIsIn);
            return readHistory(...args);
        });

        const container = mount();
        await timeToFirstMessage(container);

        expect(stateWasIn).toEqual([true]);
        expect(rows(container)).toBe(28);
    });

    it("waits for the server only when there is nothing at all to draw", async () => {
        olderHistory({ onServer: 60 });

        const container = mount();
        const elapsed = await timeToFirstMessage(container);

        expect({ elapsed, answered: answered(), rows: rows(container) }).toEqual({
            elapsed: NETWORK_MS,
            answered: ["GET /rooms/{roomId}/messages"],
            rows: 60,
        });
    });
});
