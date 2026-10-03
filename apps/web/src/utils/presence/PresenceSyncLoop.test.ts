/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// oxlint-disable-next-line no-restricted-imports
import { EventEmitter } from "events";
import {
    ClientEvent,
    type IEvent,
    type MatrixClient,
    MatrixError,
    MatrixEvent,
    type User,
    UserEvent,
} from "matrix-js-sdk/src/matrix";
import { ReEmitter } from "matrix-js-sdk/src/ReEmitter";

import {
    FAILURES_BEFORE_FALLBACK,
    LONG_POLL_TIMEOUT_MS,
    PRESENCE_ONLY_FILTER,
    PresenceSyncLoop,
    TO_DEVICE_HOLD_MS,
} from "./PresenceSyncLoop";
import SettingsStore from "../../settings/SettingsStore";
import SdkConfig from "../../SdkConfig";
import { setSlidingSyncActive } from "../sync/slidingSyncActive";

const HS = "https://maximiliangaedig.com";

interface SyncRes {
    next_batch: string;
    presence?: { events: Partial<IEvent>[] };
    to_device?: { events: unknown[] };
}

type Request = {
    params: Record<string, string>;
    signal: AbortSignal;
    resolve: (r: SyncRes) => void;
    reject: (e: unknown) => void;
};

/** Fake client whose /sync requests are held until the test answers them. */
function makeClient(): { client: MatrixClient; requests: Request[] } {
    const emitter = new EventEmitter() as any;
    const users = new Map<string, User>();
    const requests: Request[] = [];
    emitter.baseUrl = HS;
    emitter.reEmitter = new ReEmitter(emitter);
    emitter.store = { getUser: (id: string) => users.get(id) ?? null, storeUser: (u: User) => users.set(u.userId, u) };
    emitter.getUser = (id: string) => users.get(id) ?? null;
    emitter.getEventMapper = () => (raw: Partial<IEvent>) => new MatrixEvent(raw);
    emitter.http = {
        authedRequest: vi.fn(
            (_method: string, path: string, params: Record<string, string>, _body: unknown, opts: any) =>
                new Promise<SyncRes>((resolve, reject) => {
                    expect(path).toBe("/sync");
                    requests.push({ params, signal: opts?.abortSignal, resolve, reject });
                }),
        ),
    };
    return { client: emitter, requests };
}

const presence = (sender: string, content: Record<string, unknown>): Partial<IEvent> => ({
    type: "m.presence",
    sender,
    content,
});

describe("PresenceSyncLoop", () => {
    let visibility: DocumentVisibilityState;

    beforeEach(() => {
        vi.useFakeTimers();
        setSlidingSyncActive(true);
        visibility = "visible";
        vi.spyOn(SettingsStore, "getValue").mockImplementation(
            () => false as any,
        );
        SdkConfig.put({ enable_presence_by_hs_url: { [HS]: true } });
        vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    });

    afterEach(() => {
        PresenceSyncLoop.stop();
        SdkConfig.reset();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    /*
     * A client on the v2 sync resumes from its saved token and only hears about presence that changed. The
     * snapshot is how it learns everyone else's current presence, instead of trusting what the store kept.
     */
    describe("snapshot", () => {
        it("asks once, without `since`, and applies everyone's current presence", async () => {
            const { client, requests } = makeClient();
            setSlidingSyncActive(false);
            const done = PresenceSyncLoop.snapshot(client);
            expect(requests).toHaveLength(1);
            expect(requests[0].params).toEqual({ filter: JSON.stringify(PRESENCE_ONLY_FILTER), timeout: "0" });

            requests[0].resolve({
                next_batch: "s1",
                presence: { events: [presence("@alice:e", { presence: "offline", last_active_ago: 3 * 3600_000 })] },
            });
            await done;

            const alice = client.getUser("@alice:e")!;
            expect(alice.presence).toBe("offline");
            expect(alice.lastActiveAgo).toBe(3 * 3600_000);
            expect(requests).toHaveLength(1);
        });

        it("does nothing when presence is disabled for the homeserver", async () => {
            const { client, requests } = makeClient();
            SdkConfig.put({ enable_presence_by_hs_url: { [HS]: false } });
            await PresenceSyncLoop.snapshot(client);
            expect(requests).toHaveLength(0);
        });

        it("leaves presence as it was when the request fails", async () => {
            const { client, requests } = makeClient();
            const done = PresenceSyncLoop.snapshot(client);
            requests[0].reject(new MatrixError({ errcode: "M_UNKNOWN" }, 500));
            await expect(done).resolves.toBeUndefined();
            expect(client.getUser("@alice:e")).toBeNull();
        });
    });

    it("only runs with simplified sliding sync and presence enabled for the HS", () => {
        const { client, requests } = makeClient();
        setSlidingSyncActive(false);
        expect(PresenceSyncLoop.start(client)).toBeUndefined();
        setSlidingSyncActive(true);
        SdkConfig.put({ enable_presence_by_hs_url: { [HS]: false } });
        expect(PresenceSyncLoop.start(client)).toBeUndefined();
        expect(requests).toHaveLength(0);
    });

    it("long-polls a presence-only filter, keeping `since`", async () => {
        const { client, requests } = makeClient();
        PresenceSyncLoop.start(client);
        expect(requests).toHaveLength(1);
        expect(JSON.parse(requests[0].params.filter)).toEqual(PRESENCE_ONLY_FILTER);
        expect(requests[0].params.since).toBeUndefined();
        expect(requests[0].params.timeout).toBe("0");
        expect(requests[0].params.set_presence).toBeUndefined();

        requests[0].resolve({ next_batch: "s1" });
        await vi.advanceTimersByTimeAsync(0);
        expect(requests).toHaveLength(2);
        expect(requests[1].params.since).toBe("s1");
        expect(requests[1].params.timeout).toBe(String(LONG_POLL_TIMEOUT_MS));
    });

    it("feeds presence into User objects and emits the same events as /sync", async () => {
        const { client, requests } = makeClient();
        const onPresence = vi.fn();
        const onLastTs = vi.fn();
        const onActive = vi.fn();
        const onEvent = vi.fn();
        client.on(UserEvent.Presence, onPresence);
        client.on(UserEvent.LastPresenceTs, onLastTs);
        client.on(UserEvent.CurrentlyActive, onActive);
        client.on(ClientEvent.Event, onEvent);
        PresenceSyncLoop.start(client);

        requests[0].resolve({
            next_batch: "s1",
            presence: {
                events: [
                    presence("@alice:x", {
                        presence: "online",
                        currently_active: true,
                        last_active_ago: 12,
                        status_msg: "hi",
                    }),
                ],
            },
        });
        await vi.advanceTimersByTimeAsync(0);

        const alice = client.getUser("@alice:x")!;
        expect(alice.presence).toBe("online");
        expect(alice.currentlyActive).toBe(true);
        expect(alice.lastActiveAgo).toBe(12);
        expect(alice.presenceStatusMsg).toBe("hi");
        expect(onPresence.mock.calls[0][1]).toBe(alice);
        expect(onActive).toHaveBeenCalled();
        expect(onLastTs).toHaveBeenCalled();
        expect(onEvent.mock.calls[0][0].getType()).toBe("m.presence");

        // An update to an existing user object.
        requests[1].resolve({
            next_batch: "s2",
            presence: { events: [presence("@alice:x", { presence: "offline", last_active_ago: 5000 })] },
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(client.getUser("@alice:x")).toBe(alice);
        expect(alice.presence).toBe("offline");
        expect(alice.lastActiveAgo).toBe(5000);
        expect(onPresence).toHaveBeenCalledTimes(2);
    });

    it("never advances `since` past pending to-device messages (they belong to sliding sync)", async () => {
        const { client, requests } = makeClient();
        PresenceSyncLoop.start(client);
        requests[0].resolve({ next_batch: "s1" });
        await vi.advanceTimersByTimeAsync(0);

        requests[1].resolve({ next_batch: "s2", to_device: { events: [{ type: "m.room.encrypted" }] } });
        await vi.advanceTimersByTimeAsync(0);
        expect(requests).toHaveLength(2); // holding
        await vi.advanceTimersByTimeAsync(TO_DEVICE_HOLD_MS);
        expect(requests).toHaveLength(3);
        expect(requests[2].params.since).toBe("s1");

        requests[2].resolve({ next_batch: "s3", to_device: { events: [] } });
        await vi.advanceTimersByTimeAsync(0);
        expect(requests[3].params.since).toBe("s3");
    });

    it("backs off on errors and falls back to polling after repeated failures, until it recovers", async () => {
        const { client, requests } = makeClient();
        const onFallback = vi.fn();
        PresenceSyncLoop.start(client, { onFallback });

        for (let i = 0; i < FAILURES_BEFORE_FALLBACK; i++) {
            requests[i].reject(new MatrixError({ errcode: "M_UNKNOWN" }, 502));
            await vi.advanceTimersByTimeAsync(0);
            expect(requests).toHaveLength(i + 1); // waiting
            await vi.advanceTimersByTimeAsync(2_000 * 2 ** i);
            expect(requests).toHaveLength(i + 2);
        }
        expect(onFallback).toHaveBeenCalledTimes(1);
        expect(onFallback).toHaveBeenLastCalledWith(true);

        requests[FAILURES_BEFORE_FALLBACK].resolve({ next_batch: "s1" });
        await vi.advanceTimersByTimeAsync(0);
        expect(onFallback).toHaveBeenLastCalledWith(false);
    });

    it("honours retry_after_ms on 429", async () => {
        const { client, requests } = makeClient();
        PresenceSyncLoop.start(client);
        requests[0].reject(new MatrixError({ errcode: "M_LIMIT_EXCEEDED", retry_after_ms: 20_000 }, 429));
        await vi.advanceTimersByTimeAsync(19_000);
        expect(requests).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(requests).toHaveLength(2);
    });

    it("aborts while hidden and resumes with a fresh request when visible", async () => {
        const { client, requests } = makeClient();
        PresenceSyncLoop.start(client);
        requests[0].resolve({ next_batch: "s1" });
        await vi.advanceTimersByTimeAsync(0);
        expect(requests).toHaveLength(2);

        visibility = "hidden";
        document.dispatchEvent(new Event("visibilitychange"));
        expect(requests[1].signal.aborted).toBe(true);
        requests[1].reject(new Error("aborted"));
        await vi.advanceTimersByTimeAsync(60_000);
        expect(requests).toHaveLength(2);

        visibility = "visible";
        document.dispatchEvent(new Event("visibilitychange"));
        expect(requests).toHaveLength(3);
        expect(requests[2].params.since).toBe("s1");
    });

    it("stops on logout", async () => {
        const { client, requests } = makeClient();
        PresenceSyncLoop.start(client);
        PresenceSyncLoop.stop();
        expect(requests[0].signal.aborted).toBe(true);
        requests[0].resolve({ next_batch: "s1" });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(requests).toHaveLength(1);
    });
});
