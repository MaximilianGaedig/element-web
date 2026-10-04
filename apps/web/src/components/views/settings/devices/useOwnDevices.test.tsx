/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React, { type PropsWithChildren } from "react";
import { renderHook, waitFor } from "test-utils-rtl";
import { describe, expect, it, vi } from "vitest";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";
import { getMockClientWithEventEmitter, mockClientMethodsUser, TestSDKContext } from "test-utils";

import { prefetchOwnDevices, useOwnDevices } from "./useOwnDevices";
import { SDKContext } from "../../../../contexts/SDKContext";

const DEVICES = 8;
const ASK_MS = 40;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function makeClient(): MatrixClient {
    return getMockClientWithEventEmitter({
        ...mockClientMethodsUser("@alice:server.org"),
        getDeviceId: vi.fn().mockReturnValue("D0"),
        doesServerSupportUnstableFeature: vi.fn().mockResolvedValue(true),
        getDevices: vi.fn(async () => {
            await sleep(ASK_MS);
            return { devices: Array.from({ length: DEVICES }, (_, i) => ({ device_id: `D${i}` })) };
        }),
        getPushers: vi.fn(async () => {
            await sleep(ASK_MS);
            return { pushers: [] };
        }),
        getAccountData: vi.fn(),
        getAccountDataFromServer: vi.fn(),
        store: { accountData: new Map() },
        deleteAccountData: vi.fn(),
        getCrypto: vi.fn().mockReturnValue({
            getDeviceVerificationStatus: vi.fn(async () => {
                await sleep(ASK_MS);
                return { crossSigningVerified: true };
            }),
            getUserDeviceInfo: vi.fn(async () => {
                await sleep(ASK_MS);
                return new Map();
            }),
        }),
    }) as unknown as MatrixClient;
}

const wrapperFor =
    (client: MatrixClient) =>
    ({ children }: PropsWithChildren): React.JSX.Element => {
        const sdk = new TestSDKContext();
        sdk._client = client;
        return <SDKContext.Provider value={sdk}>{children}</SDKContext.Provider>;
    };

describe("useOwnDevices", () => {
    /*
     * Timed: the asks were made one after another - the devices, then each one's verification, then the
     * pushers, then the device info - so a list of sessions cost the sum of all of them (8 + 3 asks of
     * 40ms, about 440ms here). Together it is three rounds: about 120ms.
     */
    it("asks for everything at once rather than one thing after another", async () => {
        const client = makeClient();
        const started = performance.now();
        const { result } = renderHook(() => useOwnDevices(), { wrapper: wrapperFor(client) });
        await waitFor(() => expect(result.current.isLoadingDeviceList).toBe(false), { timeout: 2000 });
        const took = performance.now() - started;
        expect(Object.keys(result.current.devices)).toHaveLength(DEVICES);
        expect(took).toBeLessThan(DEVICES * ASK_MS);
    });

    it("shows what it last had at once when opened again, and refreshes underneath", async () => {
        const client = makeClient();
        const first = renderHook(() => useOwnDevices(), { wrapper: wrapperFor(client) });
        await waitFor(() => expect(first.result.current.isLoadingDeviceList).toBe(false), { timeout: 2000 });
        first.unmount();

        const second = renderHook(() => useOwnDevices(), { wrapper: wrapperFor(client) });
        expect(second.result.current.isLoadingDeviceList).toBe(false);
        expect(Object.keys(second.result.current.devices)).toHaveLength(DEVICES);
        // ...and the refresh went out regardless.
        await waitFor(() => expect(vi.mocked(client.getDevices)).toHaveBeenCalledTimes(2), { timeout: 2000 });
    });

    it("can be started before the section is, and the section joins that fetch", async () => {
        const client = makeClient();
        prefetchOwnDevices(client);
        const { result } = renderHook(() => useOwnDevices(), { wrapper: wrapperFor(client) });
        await waitFor(() => expect(result.current.isLoadingDeviceList).toBe(false), { timeout: 2000 });
        expect(vi.mocked(client.getDevices)).toHaveBeenCalledTimes(1);
    });
});
