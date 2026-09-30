/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";

import { accountLink } from "./deepLinks";

describe("accountLink", () => {
    it("addresses Telegram by username and not by its numeric id", () => {
        expect(accountLink("telegram", "440123456789", ["telegram:ada"])?.url).toBe("https://t.me/ada");
        // A numeric account has no public link, so none is offered rather than one that 404s.
        expect(accountLink("telegram", "440123456789", [])).toBeUndefined();
    });

    it("addresses WhatsApp by number, without the plus wa.me rejects", () => {
        expect(accountLink("whatsapp", "447700900456", ["tel:+447700900456"])?.url).toBe("https://wa.me/447700900456");
    });

    it("addresses Signal by number, since its own id is a UUID no link takes", () => {
        expect(accountLink("signal", "00000000-0000-4000-8000-000000000001", ["tel:+447700900789"])?.url).toBe(
            "https://signal.me/#p/+447700900789",
        );
        expect(accountLink("signal", "00000000-0000-4000-8000-000000000001", [])).toBeUndefined();
    });

    it("addresses Discord only by a snowflake", () => {
        expect(accountLink("discord", "212938191")?.url).toBe("https://discord.com/users/212938191");
        expect(accountLink("discord", "not-a-snowflake")).toBeUndefined();
    });

    it("matches the display name a bridge that published no network id leaves behind", () => {
        expect(accountLink("WhatsApp", undefined, ["tel:+447700900321"])?.url).toBe("https://wa.me/447700900321");
    });

    it("has nothing to offer for Matrix itself", () => {
        expect(accountLink("Matrix", "@ada:example.org")).toBeUndefined();
    });
});
