/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { startPresenceDelivery, stopPresenceDelivery } from "./delivery";
import { setSlidingSyncActive, setSlidingSyncPresenceActive } from "../sync/slidingSyncActive";

const mocks = vi.hoisted(() => ({
    isApplicable: vi.fn(),
    snapshot: vi.fn(),
    loopStart: vi.fn(),
    loopStop: vi.fn(),
    pollerStart: vi.fn(),
    pollerStop: vi.fn(),
}));

vi.mock("./PresenceSyncLoop", () => ({
    PresenceSyncLoop: {
        isApplicable: mocks.isApplicable,
        snapshot: mocks.snapshot,
        start: mocks.loopStart,
        stop: mocks.loopStop,
    },
}));
vi.mock("./PresencePoller", () => ({
    PresencePoller: { start: mocks.pollerStart, stop: mocks.pollerStop },
}));

const client = {} as MatrixClient;
const getOpenRoomId = (): string => "!room:hs";

describe("startPresenceDelivery", () => {
    beforeEach(() => {
        for (const mock of Object.values(mocks)) mock.mockReset();
        setSlidingSyncActive(true);
    });

    afterEach(() => {
        setSlidingSyncActive(false);
    });

    it("starts nothing when presence arrives inside sliding sync", () => {
        setSlidingSyncPresenceActive(true);
        mocks.isApplicable.mockReturnValue(true);

        startPresenceDelivery(client, getOpenRoomId);

        expect(mocks.snapshot).not.toHaveBeenCalled();
        expect(mocks.loopStart).not.toHaveBeenCalled();
        expect(mocks.pollerStart).not.toHaveBeenCalled();
    });

    it("starts nothing when presence arrives inside sliding sync, even without the loop applying", () => {
        setSlidingSyncPresenceActive(true);
        mocks.isApplicable.mockReturnValue(false);

        startPresenceDelivery(client, getOpenRoomId);

        expect(mocks.snapshot).not.toHaveBeenCalled();
        expect(mocks.loopStart).not.toHaveBeenCalled();
    });

    it("keeps the presence-only long-poll for servers without the extension", () => {
        mocks.isApplicable.mockReturnValue(true);

        startPresenceDelivery(client, getOpenRoomId);

        expect(mocks.snapshot).not.toHaveBeenCalled();
        expect(mocks.loopStart).toHaveBeenCalledWith(client, expect.any(Object));
    });

    it("takes one snapshot for a client on the other sync", () => {
        mocks.isApplicable.mockReturnValue(false);

        startPresenceDelivery(client, getOpenRoomId);

        expect(mocks.snapshot).toHaveBeenCalledWith(client);
    });

    it("falls back to the poller while the long-poll keeps failing", () => {
        mocks.isApplicable.mockReturnValue(true);

        startPresenceDelivery(client, getOpenRoomId);
        const { onFallback } = mocks.loopStart.mock.calls[0][1];
        onFallback(true);
        onFallback(false);

        expect(mocks.pollerStart).toHaveBeenCalledWith(client, { getOpenRoomId });
        expect(mocks.pollerStop).toHaveBeenCalledTimes(1);
    });

    it("stops both on stop", () => {
        stopPresenceDelivery();

        expect(mocks.loopStop).toHaveBeenCalledTimes(1);
        expect(mocks.pollerStop).toHaveBeenCalledTimes(1);
    });
});
