/*
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { logger } from "matrix-js-sdk/src/logger";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";
import fetchMock from "@fetch-mock/vitest";
import { advanceDateAndTime, stubClient, createTestClient } from "test-utils";

import { type IMatrixClientPeg, MatrixClientPeg as peg } from "./MatrixClientPeg";
import SdkConfig from "./SdkConfig";
import { createClientWithCreds } from "./utils/createMatrixClient";
import { resetBootTimings } from "./utils/bootTimings";

vi.useFakeTimers();

const PegClass = Object.getPrototypeOf(peg).constructor;

describe("MatrixClientPeg", () => {
    beforeEach(() => {
        // stub out Logger.log which gets called a lot and clutters up the test output
        vi.spyOn(logger, "log").mockImplementation(() => {});
    });

    afterEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();

        // some of the tests assign `MatrixClientPeg.matrixClient`: clear it, to prevent leakage between tests
        peg.unset();
    });

    it("setJustRegisteredUserId", () => {
        stubClient();
        (peg as any).matrixClient = peg.get();
        peg.setJustRegisteredUserId("@userId:matrix.org");
        expect(peg.safeGet().credentials.userId).toBe("@userId:matrix.org");
        expect(peg.currentUserIsJustRegistered()).toBe(true);
        expect(peg.userRegisteredWithinLastHours(0)).toBe(false);
        expect(peg.userRegisteredWithinLastHours(1)).toBe(true);
        expect(peg.userRegisteredWithinLastHours(24)).toBe(true);
        advanceDateAndTime(1 * 60 * 60 * 1000 + 1);
        expect(peg.userRegisteredWithinLastHours(0)).toBe(false);
        expect(peg.userRegisteredWithinLastHours(1)).toBe(false);
        expect(peg.userRegisteredWithinLastHours(24)).toBe(true);
        advanceDateAndTime(24 * 60 * 60 * 1000);
        expect(peg.userRegisteredWithinLastHours(0)).toBe(false);
        expect(peg.userRegisteredWithinLastHours(1)).toBe(false);
        expect(peg.userRegisteredWithinLastHours(24)).toBe(false);
    });

    it("setJustRegisteredUserId(null)", () => {
        stubClient();
        (peg as any).matrixClient = peg.get();
        peg.setJustRegisteredUserId(null);
        expect(peg.currentUserIsJustRegistered()).toBe(false);
        expect(peg.userRegisteredWithinLastHours(0)).toBe(false);
        expect(peg.userRegisteredWithinLastHours(1)).toBe(false);
        expect(peg.userRegisteredWithinLastHours(24)).toBe(false);
        advanceDateAndTime(1 * 60 * 60 * 1000 + 1);
        expect(peg.userRegisteredWithinLastHours(0)).toBe(false);
        expect(peg.userRegisteredWithinLastHours(1)).toBe(false);
        expect(peg.userRegisteredWithinLastHours(24)).toBe(false);
    });

    describe(".start", () => {
        let testPeg: IMatrixClientPeg;

        beforeEach(() => {
            // instantiate a MatrixClientPegClass instance, with a new MatrixClient
            testPeg = new PegClass();
            fetchMock.get("http://example.com/_matrix/client/versions", {});

            const mockClient = createTestClient();
            mockClient.initRustCrypto = vi.fn();
            mockClient.startClient = vi.fn();
            testPeg.set(mockClient as unknown as MatrixClient);
        });

        it("should initialise the rust crypto library by default", async () => {
            const mockInitRustCrypto = vi.spyOn(testPeg.safeGet(), "initRustCrypto").mockResolvedValue(undefined);

            const cryptoStoreKey = new Uint8Array([1, 2, 3, 4]);
            await testPeg.start({ rustCryptoStoreKey: cryptoStoreKey });
            expect(mockInitRustCrypto).toHaveBeenCalledWith({ storageKey: cryptoStoreKey });
        });

        it("should try to start dehydration if dehydration is enabled", async () => {
            const mockInitRustCrypto = vi.spyOn(testPeg.safeGet(), "initRustCrypto").mockResolvedValue(undefined);
            const mockStartDehydration = vi.fn();
            vi.spyOn(testPeg.safeGet(), "getCrypto").mockReturnValue({
                isDehydrationSupported: vi.fn().mockResolvedValue(true),
                startDehydration: mockStartDehydration,
                setDeviceIsolationMode: vi.fn(),
            } as any);
            vi.spyOn(testPeg.safeGet(), "waitForClientWellKnown").mockResolvedValue({
                "m.homeserver": {
                    base_url: "http://example.com",
                },
                "org.matrix.msc3814": true,
            } as any);

            const cryptoStoreKey = new Uint8Array([1, 2, 3, 4]);
            await testPeg.start({ rustCryptoStoreKey: cryptoStoreKey });
            expect(mockInitRustCrypto).toHaveBeenCalledWith({ storageKey: cryptoStoreKey });
            expect(mockStartDehydration).toHaveBeenCalledWith({ onlyIfKeyCached: true, rehydrate: false });
        });

        it("marks the boot steps it completes, and the saved sync with its size", async () => {
            resetBootTimings();
            // The file runs on fake timers, which stub User Timing out: watch the calls instead.
            const mark = vi.spyOn(performance, "mark").mockImplementation(() => ({}) as PerformanceMark);
            const client = testPeg.safeGet();
            vi.spyOn(client, "initRustCrypto").mockResolvedValue(undefined);
            const getSavedSync = vi.fn().mockResolvedValue({
                nextBatch: "s1",
                roomsData: { join: { "!a:example.com": { timeline: { events: [{}, {}] } } } },
                accountData: [{}],
            });
            client.store = { startup: vi.fn().mockResolvedValue(undefined), getSavedSync } as any;

            await testPeg.start();
            // The sync loop reads the saved sync once, as the client starts.
            await client.store.getSavedSync();

            expect(mark.mock.calls.map(([name]) => name)).toEqual([
                "mx_boot:store_opened",
                "mx_boot:crypto_opened",
                "mx_boot:client_started",
                "mx_boot:saved_sync_loaded",
            ]);
            expect(mark.mock.calls[3][1]).toEqual({
                detail: { rooms: 1, timelineEvents: 2, stateEvents: 0, accountData: 1 },
            });
            // The store has its own method back: only the boot's read is timed.
            expect(client.store.getSavedSync).toBe(getSavedSync);
            resetBootTimings();
        });

        describe("opening the two stores", () => {
            let storeOpen: PromiseWithResolvers<void>;
            let cryptoOpen: PromiseWithResolvers<void>;
            let client: MatrixClient;

            beforeEach(() => {
                storeOpen = Promise.withResolvers<void>();
                cryptoOpen = Promise.withResolvers<void>();
                // Quiet the handle itself; what the peg derives from it must still be handled by the peg.
                cryptoOpen.promise.catch(() => {});
                storeOpen.promise.catch(() => {});
                client = testPeg.safeGet();
                client.store = { startup: vi.fn(() => storeOpen.promise) } as any;
                vi.spyOn(client, "initRustCrypto").mockImplementation(() => cryptoOpen.promise);
            });

            /** Let everything that can run without one of the stores opening run. */
            const settle = (): Promise<void> => vi.advanceTimersByTimeAsync(0).then(() => {});

            it("opens the crypto store while the sync store is still opening", async () => {
                const started = testPeg.start();
                await settle();

                // The sync store has not opened, and the crypto store is already on its way.
                expect(client.store.startup).toHaveBeenCalledTimes(1);
                expect(client.initRustCrypto).toHaveBeenCalledTimes(1);

                storeOpen.resolve();
                cryptoOpen.resolve();
                await started;
            });

            it.each([
                ["the sync store", (): void => cryptoOpen.resolve(), (): void => storeOpen.resolve()],
                ["the crypto store", (): void => storeOpen.resolve(), (): void => cryptoOpen.resolve()],
            ])("does not start the client until %s is open too", async (_name, openOther, openThisOne) => {
                const started = testPeg.start();
                openOther();
                await settle();
                // The saved sync holds encrypted events and comes out of the sync store: it needs both.
                expect(client.startClient).not.toHaveBeenCalled();

                openThisOne();
                await started;
                expect(client.startClient).toHaveBeenCalledTimes(1);
            });

            it("still falls back to a memory store, and still waits for crypto, when IndexedDB fails", async () => {
                vi.spyOn(logger, "error").mockImplementation(() => {});
                const brokenStore = client.store;
                const started = testPeg.start();
                storeOpen.reject(new Error("IndexedDB is gone"));
                await settle();

                expect(client.store).not.toBe(brokenStore);
                expect(client.startClient).not.toHaveBeenCalled();

                cryptoOpen.resolve();
                await started;
                expect(client.startClient).toHaveBeenCalledTimes(1);
            });

            // A rejection nobody handled fails the whole run, so this also checks there is no stray one.
            it("fails to start when crypto fails while the sync store is still opening", async () => {
                const started = testPeg.start();
                const outcome = started.then(
                    () => "started",
                    (e: Error) => e.message,
                );

                cryptoOpen.reject(new Error("no WASM today"));
                await settle();
                storeOpen.resolve();

                expect(await outcome).toBe("no WASM today");
                await settle();
                expect(client.startClient).not.toHaveBeenCalled();
            });
        });

        it("Should migrate existing login", async () => {
            const mockInitRustCrypto = vi.spyOn(testPeg.safeGet(), "initRustCrypto").mockResolvedValue(undefined);

            await testPeg.start();
            expect(mockInitRustCrypto).toHaveBeenCalledTimes(1);
        });

        it("should poll the client well-known by default", async () => {
            vi.spyOn(testPeg.safeGet(), "initRustCrypto").mockResolvedValue(undefined);
            const startClient = vi.spyOn(testPeg.safeGet(), "startClient").mockResolvedValue(undefined);

            await testPeg.start();

            const opts = startClient.mock.calls[0][0];
            expect(opts?.clientWellKnownPollPeriod).toBe(2 * 60 * 60);
        });

        it("should not poll the client well-known when enable_client_well_known_lookups is false", async () => {
            const sdkConfigGet = SdkConfig.get;
            vi.spyOn(SdkConfig, "get").mockImplementation((key?: any, altCaseName?: string): any => {
                if (key === "enable_client_well_known_lookups") return false;
                return sdkConfigGet(key, altCaseName);
            });
            vi.spyOn(testPeg.safeGet(), "initRustCrypto").mockResolvedValue(undefined);
            const startClient = vi.spyOn(testPeg.safeGet(), "startClient").mockResolvedValue(undefined);

            await testPeg.start();

            const opts = startClient.mock.calls[0][0];
            expect(opts?.clientWellKnownPollPeriod).toBeUndefined();
        });

        describe("client well-known lookups", () => {
            const WELL_KNOWN_URL = "https://example.com/.well-known/matrix/client";

            beforeEach(() => {
                // Use a real MatrixClient and really start it: these tests exist to observe what the SDK
                // requests over the network, which mocking `startClient` (as above) cannot see. This is
                // what caught matrix-js-sdk fetching the well-known despite `clientWellKnownPollPeriod`
                // being unset.
                testPeg = new PegClass();
                testPeg.set(
                    createClientWithCreds({
                        homeserverUrl: "http://example.com",
                        userId: "@user:example.com",
                        deviceId: "DEVICE",
                        accessToken: "token",
                    }),
                );
                vi.spyOn(testPeg.safeGet(), "initRustCrypto").mockResolvedValue(undefined);
            });

            afterEach(() => {
                testPeg.get()?.stopClient();
                testPeg.unset();
            });

            async function requestedUrls(): Promise<string[]> {
                await fetchMock.callHistory.flush();
                return fetchMock.callHistory.calls().map((call) => call.url);
            }

            it("requests the client well-known on startup by default", async () => {
                await testPeg.start();

                expect(await requestedUrls()).toContain(WELL_KNOWN_URL);
            });

            it("never requests the client well-known when enable_client_well_known_lookups is false", async () => {
                const sdkConfigGet = SdkConfig.get;
                vi.spyOn(SdkConfig, "get").mockImplementation((key?: any, altCaseName?: string): any => {
                    if (key === "enable_client_well_known_lookups") return false;
                    return sdkConfigGet(key, altCaseName);
                });

                await testPeg.start();

                expect(await requestedUrls()).not.toContainEqual(expect.stringContaining("/.well-known/matrix/"));
            });
        });
    });
});
