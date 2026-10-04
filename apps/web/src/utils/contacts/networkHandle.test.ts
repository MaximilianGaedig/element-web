/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import { bridgedPersonLine, networkHandle } from "./networkHandle";

const client = { getVisibleRooms: () => [] } as unknown as MatrixClient;

describe("networkHandle", () => {
    it("prefers a username, then a number, then an address", () => {
        expect(networkHandle(["tel:+48123456789", "telegram:ada"])).toBe("@ada");
        expect(networkHandle(["tel:+48123456789", "mailto:ada@example.com"])).toBe("+48123456789");
        expect(networkHandle(["mailto:Ada@Example.com"])).toBe("ada@example.com");
        expect(networkHandle(["instagram:@ada"])).toBe("@ada");
    });

    it("has nothing to show when the network published nothing", () => {
        expect(networkHandle([])).toBeUndefined();
        expect(networkHandle(["", "tel:"])).toBeUndefined();
    });
});

describe("bridgedPersonLine", () => {
    it("names the network beside the handle, and the network alone without one", () => {
        expect(bridgedPersonLine(client, { network: "telegram", identifiers: ["telegram:ada"] })).toBe(
            "@ada · Telegram",
        );
        expect(bridgedPersonLine(client, { network: "signal", identifiers: [] })).toBe("Signal");
    });

    it("says when the network's own address book holds them", () => {
        expect(bridgedPersonLine(client, { network: "telegram", identifiers: ["telegram:ada"] }, "Telegram")).toBe(
            "@ada · In your Telegram contacts",
        );
    });

    it("leaves a Matrix account to its Matrix ID", () => {
        expect(bridgedPersonLine(client, { identifiers: ["tel:+48123456789"] })).toBeUndefined();
    });
});
