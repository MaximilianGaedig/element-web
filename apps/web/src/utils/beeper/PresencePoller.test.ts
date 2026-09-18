/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { EventEmitter } from "events";
import { type MatrixClient, MatrixError, type Room, type User, UserEvent } from "matrix-js-sdk/src/matrix";
import { ReEmitter } from "matrix-js-sdk/src/ReEmitter";

import {
    DM_LIST_INTERVAL_MS,
    MAX_CONCURRENCY,
    MAX_USERS_PER_CYCLE,
    OPEN_DM_INTERVAL_MS,
    PresencePoller,
} from "./PresencePoller";
import SettingsStore from "../../settings/SettingsStore";
import SdkConfig from "../../SdkConfig";
import DMRoomMap from "../DMRoomMap";

const HS = "https://maximiliangaedig.com";
const GHOST_STATUS = {
    presence: "unavailable",
    status_msg: "last seen recently",
    last_active_ago: 80765,
    currently_active: false,
};

/** A small fake client: rooms are DMs with `@dm<i>:x`, user store, re-emitter. */
function makeClient(dmCount: number): MatrixClient & { getPresence: Mock } {
    const emitter = new EventEmitter() as any;
    const users = new Map<string, User>();
    const rooms: Room[] = Array.from({ length: dmCount }, (_, i) => ({
        roomId: `!dm${i}:x`,
        getMyMembership: () => "join",
        getLastActiveTimestamp: () => i, // higher index = more recent
        currentState: { getStateEvents: () => [] },
    })) as unknown as Room[];
    emitter.baseUrl = HS;
    emitter.reEmitter = new ReEmitter(emitter);
    emitter.store = { getUser: (id: string) => users.get(id) ?? null, storeUser: (u: User) => users.set(u.userId, u) };
    emitter.getUser = (id: string) => users.get(id) ?? null;
    emitter.getRoom = (id: string) => rooms.find((r) => r.roomId === id) ?? null;
    emitter.getVisibleRooms = () => rooms;
    emitter.getPresence = vi.fn().mockResolvedValue(GHOST_STATUS);
    return emitter;
}

const flush = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe("PresencePoller", () => {
    let slidingSync: boolean;
    let visibility: DocumentVisibilityState;

    beforeEach(() => {
        vi.useFakeTimers();
        slidingSync = true;
        visibility = "visible";
        vi.spyOn(SettingsStore, "getValue").mockImplementation(
            (name: string) => (name === "feature_simplified_sliding_sync" ? slidingSync : false) as any,
        );
        SdkConfig.put({ enable_presence_by_hs_url: { [HS]: true } });
        vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
        vi.spyOn(DMRoomMap, "shared").mockReturnValue({
            getUserIdForRoomId: (roomId: string) => `@${roomId.slice(1).split(":")[0]}:x`,
        } as unknown as DMRoomMap);
    });

    afterEach(() => {
        PresencePoller.stop();
        SdkConfig.reset();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("does nothing without simplified sliding sync, or with presence disabled for the HS", async () => {
        const client = makeClient(1);
        slidingSync = false;
        PresencePoller.start(client, { getOpenRoomId: () => "!dm0:x" });
        await vi.advanceTimersByTimeAsync(DM_LIST_INTERVAL_MS);
        expect(client.getPresence).not.toHaveBeenCalled();

        slidingSync = true;
        SdkConfig.put({ enable_presence_by_hs_url: { [HS]: false } });
        PresencePoller.start(client, { getOpenRoomId: () => "!dm0:x" });
        await vi.advanceTimersByTimeAsync(DM_LIST_INTERVAL_MS);
        expect(client.getPresence).not.toHaveBeenCalled();
    });

    it("feeds polled presence into User objects and emits presence events like /sync", async () => {
        const client = makeClient(1);
        const onPresence = vi.fn();
        const onLastTs = vi.fn();
        client.on(UserEvent.Presence, onPresence);
        client.on(UserEvent.LastPresenceTs, onLastTs);
        PresencePoller.start(client, { getOpenRoomId: () => "!dm0:x" });
        await vi.advanceTimersByTimeAsync(0);
        await flush();

        const user = client.getUser("@dm0:x")!;
        expect(user.presence).toBe("unavailable");
        expect(user.presenceStatusMsg).toBe("last seen recently");
        expect(user.lastActiveAgo).toBe(80765);
        expect(user.currentlyActive).toBe(false);
        expect(onPresence.mock.calls[0][1]).toBe(user);
        expect(onLastTs).toHaveBeenCalled();
    });

    it("polls the open DM every 30s and promptly when another DM is opened", async () => {
        const client = makeClient(3);
        let open = "!dm0:x";
        PresencePoller.start(client, { getOpenRoomId: () => open });
        await vi.advanceTimersByTimeAsync(0);
        const openCalls = (): number => client.getPresence.mock.calls.filter(([u]) => u === "@dm0:x").length;
        const afterStart = openCalls();

        await vi.advanceTimersByTimeAsync(OPEN_DM_INTERVAL_MS - 6_000);
        expect(openCalls()).toBe(afterStart);
        await vi.advanceTimersByTimeAsync(6_000);
        expect(openCalls()).toBe(afterStart + 1);

        client.getPresence.mockClear();
        open = "!dm1:x";
        await vi.advanceTimersByTimeAsync(5_000);
        expect(client.getPresence).toHaveBeenCalledWith("@dm1:x");
    });

    it("polls recent DMs (most recent first) with capped total and concurrency", async () => {
        const client = makeClient(80);
        let inFlight = 0;
        let maxInFlight = 0;
        client.getPresence.mockImplementation(async () => {
            inFlight++;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise((r) => setTimeout(r, 10));
            inFlight--;
            return GHOST_STATUS;
        });
        PresencePoller.start(client, { getOpenRoomId: () => null });
        await vi.advanceTimersByTimeAsync(1_000);

        const polled = client.getPresence.mock.calls.map(([u]) => u);
        expect(polled).toHaveLength(MAX_USERS_PER_CYCLE);
        expect(polled[0]).toBe("@dm79:x");
        expect(maxInFlight).toBeLessThanOrEqual(MAX_CONCURRENCY);

        client.getPresence.mockClear();
        await vi.advanceTimersByTimeAsync(DM_LIST_INTERVAL_MS);
        expect(client.getPresence).toHaveBeenCalledTimes(MAX_USERS_PER_CYCLE);
    });

    it("pauses while the tab is hidden and refreshes when it becomes visible", async () => {
        const client = makeClient(1);
        PresencePoller.start(client, { getOpenRoomId: () => "!dm0:x" });
        await vi.advanceTimersByTimeAsync(0);
        client.getPresence.mockClear();

        visibility = "hidden";
        document.dispatchEvent(new Event("visibilitychange"));
        await vi.advanceTimersByTimeAsync(5 * DM_LIST_INTERVAL_MS);
        expect(client.getPresence).not.toHaveBeenCalled();

        visibility = "visible";
        document.dispatchEvent(new Event("visibilitychange"));
        await vi.advanceTimersByTimeAsync(0);
        expect(client.getPresence).toHaveBeenCalledWith("@dm0:x");
    });

    it("backs off on 429 using retry_after_ms", async () => {
        const client = makeClient(1);
        client.getPresence.mockRejectedValue(
            new MatrixError({ errcode: "M_LIMIT_EXCEEDED", retry_after_ms: 300_000 }, 429),
        );
        PresencePoller.start(client, { getOpenRoomId: () => "!dm0:x" });
        await vi.advanceTimersByTimeAsync(0);
        const calls = client.getPresence.mock.calls.length;
        expect(calls).toBeGreaterThan(0);

        client.getPresence.mockResolvedValue(GHOST_STATUS);
        await vi.advanceTimersByTimeAsync(250_000);
        expect(client.getPresence).toHaveBeenCalledTimes(calls);
        await vi.advanceTimersByTimeAsync(DM_LIST_INTERVAL_MS);
        expect(client.getPresence.mock.calls.length).toBeGreaterThan(calls);
    });

    it("doesn't back off for users without presence (404)", async () => {
        const client = makeClient(2);
        client.getPresence.mockImplementation(async (u: string) => {
            if (u === "@dm1:x") throw new MatrixError({ errcode: "M_NOT_FOUND" }, 404);
            return GHOST_STATUS;
        });
        PresencePoller.start(client, { getOpenRoomId: () => null });
        await vi.advanceTimersByTimeAsync(0);
        expect(client.getUser("@dm0:x")?.presence).toBe("unavailable");
        client.getPresence.mockClear();
        await vi.advanceTimersByTimeAsync(DM_LIST_INTERVAL_MS);
        expect(client.getPresence).toHaveBeenCalledTimes(2);
    });
});
