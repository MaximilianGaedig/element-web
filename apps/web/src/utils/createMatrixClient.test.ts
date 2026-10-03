/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { vi, describe, beforeEach, it, expect } from "vitest";
import { type MatrixClient, RoomNameType } from "matrix-js-sdk/src/matrix";
import { mockPlatformPeg } from "test-utils";

import { createClientWithCreds, rememberSlidingSyncSupport, slidingSyncExpected } from "./createMatrixClient";
import SettingsStore from "../settings/SettingsStore";
import PlatformPeg from "../PlatformPeg";

describe("createMatrixClient", () => {
    let client: MatrixClient;

    beforeEach(() => {
        vi.stubGlobal("localStorage", {
            getItem: vi.fn().mockReturnValue(null),
            setItem: vi.fn(),
            removeItem: vi.fn(),
        });

        client = createClientWithCreds({
            homeserverUrl: "https://test.dummy",
            userId: "@user:test.dummy",
            accessToken: "access_token",
        });
    });

    // Sliding sync keeps its own cache; loading the other sync's stored /sync would hold the account twice.
    describe("the store", () => {
        it("is kept in memory under sliding sync, and in IndexedDB otherwise", async () => {
            // The module reads both when it is loaded
            vi.resetModules();
            vi.stubGlobal("indexedDB", {});
            Object.defineProperty(window, "indexedDB", { value: {}, configurable: true });
            const fresh = await import("./createMatrixClient");
            // ...with the store classes of the copy of the SDK it was loaded with
            const sdk = await import("matrix-js-sdk/src/matrix");

            expect(fresh.createMatrixClient({ baseUrl: "" }, { slidingSync: true }).store).toBeInstanceOf(
                sdk.MemoryStore,
            );
            expect(fresh.createMatrixClient({ baseUrl: "" }).store).toBeInstanceOf(sdk.IndexedDBStore);
            Object.defineProperty(window, "indexedDB", { value: undefined, configurable: true });
        });

        it("expects sliding sync where it is on, unless the server was found without it", () => {
            vi.spyOn(SettingsStore, "getValue").mockReturnValue(true);
            window.localStorage.removeItem("mx_sliding_sync_support:https://test.dummy");
            expect(slidingSyncExpected("https://test.dummy")).toBe(true);
            rememberSlidingSyncSupport("https://test.dummy", false);
            expect(slidingSyncExpected("https://test.dummy")).toBe(false);
            rememberSlidingSyncSupport("https://test.dummy", true);
            vi.mocked(SettingsStore.getValue).mockReturnValue(false);
            expect(slidingSyncExpected("https://test.dummy")).toBe(false);
            vi.mocked(SettingsStore.getValue).mockRestore();
        });
    });

    describe("room name generator", () => {
        it("should return empty room for an empty room", () => {
            const roomName = client.roomNameGenerator?.("", {
                type: RoomNameType.EmptyRoom,
            });
            expect(roomName).toBe("Empty room");
        });

        it("should include the old name for an empty room that used to have a name", () => {
            const roomName = client.roomNameGenerator?.("", {
                type: RoomNameType.EmptyRoom,
                oldName: "Old Room",
            });
            expect(roomName).toBe("Empty room (was Old Room)");
        });

        it("should return null for an actual room name", () => {
            const roomName = client.roomNameGenerator?.("", {
                type: RoomNameType.Actual,
                name: "Some name",
            });
            expect(roomName).toBeNull();
        });

        describe("generated room names", () => {
            it("should return empty room when there are no members", () => {
                const roomName = client.roomNameGenerator?.("", {
                    type: RoomNameType.Generated,
                    names: [],
                    count: 0,
                });
                expect(roomName).toBe("Empty room");
            });

            it("should return the single member name when there is only one other member", () => {
                const roomName = client.roomNameGenerator?.("", {
                    type: RoomNameType.Generated,
                    names: ["Alice"],
                    count: 2,
                });
                expect(roomName).toBe("Alice");
            });

            it("should join two member names with 'and'", () => {
                const roomName = client.roomNameGenerator?.("", {
                    type: RoomNameType.Generated,
                    names: ["Alice", "Bob"],
                    count: 2,
                });
                expect(roomName).toBe("Alice and Bob");
            });

            it("should name the first member and count the rest when there is one other member not named", () => {
                const roomName = client.roomNameGenerator?.("", {
                    type: RoomNameType.Generated,
                    names: ["Alice", "Bob"],
                    count: 3,
                });
                expect(roomName).toBe("Alice and one other");
            });

            it("should name the first member and count the rest when there are multiple members not named", () => {
                const roomName = client.roomNameGenerator?.("", {
                    type: RoomNameType.Generated,
                    names: ["Alice", "Bob", "Carol"],
                    count: 3,
                });
                expect(roomName).toBe("Alice and 2 others");
            });

            describe("when inviting", () => {
                it("should return empty room when there are no invitees", () => {
                    const roomName = client.roomNameGenerator?.("", {
                        type: RoomNameType.Generated,
                        subtype: "Inviting",
                        names: [],
                        count: 0,
                    });
                    expect(roomName).toBe("Empty room");
                });

                it("should return the single invitee name when there is only one invitee", () => {
                    const roomName = client.roomNameGenerator?.("", {
                        type: RoomNameType.Generated,
                        subtype: "Inviting",
                        names: ["Alice"],
                        count: 1,
                    });
                    expect(roomName).toBe("Alice");
                });

                it("should say who is being invited when there are two invitees", () => {
                    const roomName = client.roomNameGenerator?.("", {
                        type: RoomNameType.Generated,
                        subtype: "Inviting",
                        names: ["Alice", "Bob"],
                        count: 2,
                    });
                    expect(roomName).toBe("Inviting Alice and Bob");
                });

                it("should name the first invitee and count the rest when there are more than two invitees", () => {
                    const roomName = client.roomNameGenerator?.("", {
                        type: RoomNameType.Generated,
                        subtype: "Inviting",
                        names: ["Alice", "Bob", "Carol"],
                        count: 3,
                    });
                    expect(roomName).toBe("Inviting Alice and 2 others");
                });

                it("should count uninvited members separately from named invitees", () => {
                    const roomName = client.roomNameGenerator?.("", {
                        type: RoomNameType.Generated,
                        subtype: "Inviting",
                        names: ["Alice", "Bob"],
                        count: 4,
                    });
                    expect(roomName).toBe("Inviting Alice and 3 others");
                });
            });
        });
    });

    describe("oauth2ClientConfig", () => {
        beforeEach(() => {
            mockPlatformPeg();
            Object.defineProperty(PlatformPeg.get(), "getOAuthCallbackUrl", {
                value: () => new URL("https://test.dummy/oauth/callback"),
            });
        });

        it("should not be set when there is no refresh token", () => {
            client = createClientWithCreds({
                homeserverUrl: "https://test.dummy",
                userId: "@user:test.dummy",
                accessToken: "access_token",
            });

            expect(client.http.opts.oauth2ClientConfig).toBeUndefined();
        });

        it("should not be set when there is a refresh token but no stored OAuth2 client ID", () => {
            client = createClientWithCreds({
                homeserverUrl: "https://test.dummy",
                userId: "@user:test.dummy",
                accessToken: "access_token",
                refreshToken: "refresh_token",
            });

            expect(client.http.opts.oauth2ClientConfig).toBeUndefined();
        });

        it("should be set from the stored OAuth2 client ID when there is a refresh token", () => {
            client = createClientWithCreds(
                {
                    homeserverUrl: "https://test.dummy",
                    userId: "@user:test.dummy",
                    accessToken: "access_token",
                    refreshToken: "refresh_token",
                },
                "test-client-id",
            );

            expect(client.http.opts.oauth2ClientConfig).toEqual(
                expect.objectContaining({
                    clientId: "test-client-id",
                }),
            );
        });
    });
});
