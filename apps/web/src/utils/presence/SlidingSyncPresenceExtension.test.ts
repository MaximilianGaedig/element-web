/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { type IEvent, type MatrixClient } from "matrix-js-sdk/src/matrix";
import { ExtensionState, type SlidingSync } from "matrix-js-sdk/src/sliding-sync";

import {
    PRESENCE_EXTENSION_FEATURE,
    PRESENCE_EXTENSION_NAME,
    SlidingSyncPresenceExtension,
    registerSlidingSyncPresence,
} from "./SlidingSyncPresenceExtension";
import { isSlidingSyncPresenceActive, setSlidingSyncActive } from "../sync/slidingSyncActive";
import SdkConfig from "../../SdkConfig";

const applyPresenceEvent = vi.hoisted(() => vi.fn());
vi.mock("./PresenceSyncLoop", () => ({ applyPresenceEvent }));

function mkClient(supported: boolean | Error): MatrixClient {
    return {
        baseUrl: "https://hs.example",
        doesServerSupportUnstableFeature: vi.fn(async (feature: string) => {
            if (supported instanceof Error) throw supported;
            return supported && feature === PRESENCE_EXTENSION_FEATURE;
        }),
    } as unknown as MatrixClient;
}

function mkSlidingSync(): SlidingSync {
    return { registerExtension: vi.fn() } as unknown as SlidingSync;
}

describe("SlidingSyncPresenceExtension", () => {
    beforeEach(() => {
        applyPresenceEvent.mockReset();
        setSlidingSyncActive(true);
    });

    afterEach(() => {
        setSlidingSyncActive(false);
        vi.restoreAllMocks();
    });

    it("is the im.mxg.presence extension, asked for on every request", async () => {
        const ext = new SlidingSyncPresenceExtension(mkClient(true));

        expect(ext.name()).toBe("im.mxg.presence");
        expect(ext.name()).toBe(PRESENCE_EXTENSION_NAME);
        expect(ext.when()).toBe(ExtensionState.PostProcess);
        expect(await ext.onRequest()).toEqual({ enabled: true });
    });

    it("feeds each presence event through applyPresenceEvent", async () => {
        const client = mkClient(true);
        const ext = new SlidingSyncPresenceExtension(client);
        const a: Partial<IEvent> = { type: "m.presence", sender: "@a:hs", content: { presence: "online" } };
        const b: Partial<IEvent> = { type: "m.presence", sender: "@b:hs", content: { presence: "offline" } };

        await ext.onResponse({ events: [a, b] });

        expect(applyPresenceEvent).toHaveBeenCalledTimes(2);
        expect(applyPresenceEvent).toHaveBeenNthCalledWith(1, client, a);
        expect(applyPresenceEvent).toHaveBeenNthCalledWith(2, client, b);
    });

    it("does not stop at an event that cannot be applied", async () => {
        const ext = new SlidingSyncPresenceExtension(mkClient(true));
        applyPresenceEvent.mockImplementationOnce(() => {
            throw new Error("bad event");
        });

        await ext.onResponse({ events: [{ sender: "@a:hs" }, { sender: "@b:hs" }] });

        expect(applyPresenceEvent).toHaveBeenCalledTimes(2);
    });

    it("tolerates a response without events", async () => {
        const ext = new SlidingSyncPresenceExtension(mkClient(true));

        await ext.onResponse({});

        expect(applyPresenceEvent).not.toHaveBeenCalled();
    });

    describe("registerSlidingSyncPresence", () => {
        it("registers the extension when the server advertises it", async () => {
            const slidingSync = mkSlidingSync();

            expect(await registerSlidingSyncPresence(slidingSync, mkClient(true))).toBe(true);

            expect(slidingSync.registerExtension).toHaveBeenCalledTimes(1);
            const registered = vi.mocked(slidingSync.registerExtension).mock.calls[0][0];
            expect(registered.name()).toBe("im.mxg.presence");
            expect(isSlidingSyncPresenceActive()).toBe(true);
        });

        it("leaves the old path in place when the server does not advertise it", async () => {
            const slidingSync = mkSlidingSync();

            expect(await registerSlidingSyncPresence(slidingSync, mkClient(false))).toBe(false);

            expect(slidingSync.registerExtension).not.toHaveBeenCalled();
            expect(isSlidingSyncPresenceActive()).toBe(false);
        });

        it("leaves the old path in place when the server's features cannot be read", async () => {
            const slidingSync = mkSlidingSync();

            expect(await registerSlidingSyncPresence(slidingSync, mkClient(new Error("offline")))).toBe(false);

            expect(slidingSync.registerExtension).not.toHaveBeenCalled();
            expect(isSlidingSyncPresenceActive()).toBe(false);
        });

        it("registers nothing when presence is off for the homeserver", async () => {
            vi.spyOn(SdkConfig, "get").mockImplementation(((key: string) =>
                key === "enable_presence_by_hs_url" ? { "https://hs.example": false } : undefined) as never);
            const slidingSync = mkSlidingSync();

            expect(await registerSlidingSyncPresence(slidingSync, mkClient(true))).toBe(false);

            expect(slidingSync.registerExtension).not.toHaveBeenCalled();
            expect(isSlidingSyncPresenceActive()).toBe(false);
        });

        it("stops counting as active when sliding sync stops", async () => {
            await registerSlidingSyncPresence(mkSlidingSync(), mkClient(true));
            expect(isSlidingSyncPresenceActive()).toBe(true);

            setSlidingSyncActive(false);

            expect(isSlidingSyncPresenceActive()).toBe(false);
        });
    });
});
