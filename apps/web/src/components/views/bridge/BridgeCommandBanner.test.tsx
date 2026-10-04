/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "test-utils-rtl";

import BridgeCommandBanner, { bridgeSendTitle } from "./BridgeCommandBanner";
import { type BridgeCommandContext, type ComposerTarget } from "../../../utils/bridge/bridgeCommands";

const portal: BridgeCommandContext = { kind: "portal", network: "Telegram", networkKey: "telegram", prefix: "!tg" };
const management: BridgeCommandContext = { ...portal, kind: "management" };

describe("BridgeCommandBanner", () => {
    it("says a command in a chat is not sent to the person", () => {
        render(
            <BridgeCommandBanner
                target={{ kind: "command", bridge: portal }}
                roomName="Alice"
                warned={false}
                onSendAnyway={vi.fn()}
            />,
        );
        expect(screen.getByRole("status").textContent).toBe("Command to the Telegram bridge — not sent to Alice");
    });

    it("says a message in the management room is a command", () => {
        render(
            <BridgeCommandBanner
                target={{ kind: "command", bridge: management }}
                roomName="Telegram bridge"
                warned={false}
                onSendAnyway={vi.fn()}
            />,
        );
        expect(screen.getByRole("status").textContent).toBe("Command to the Telegram bridge");
    });

    it("warns about a command for another bridge, and lets it be sent anyway", () => {
        const onSendAnyway = vi.fn();
        const target: ComposerTarget = {
            kind: "wrong-bridge",
            bridge: portal,
            intended: { prefix: "!wa", network: "WhatsApp" },
        };
        render(<BridgeCommandBanner target={target} roomName="Alice" warned={false} onSendAnyway={onSendAnyway} />);
        expect(screen.getByRole("alert").textContent).toContain("command for the WhatsApp bridge");
        expect(screen.getByRole("alert").textContent).toContain("sent to Alice on Telegram as a message");
        fireEvent.click(screen.getByText("Send anyway"));
        expect(onSendAnyway).toHaveBeenCalled();
    });

    it("shows nothing for plain text, whose destination the placeholder gives", () => {
        const { container } = render(
            <BridgeCommandBanner
                target={{ kind: "relay", bridge: portal }}
                roomName="Alice"
                warned={false}
                onSendAnyway={vi.fn()}
            />,
        );
        expect(container).toBeEmptyDOMElement();
    });
});

describe("bridgeSendTitle", () => {
    it("names where the send button sends", () => {
        expect(bridgeSendTitle({ kind: "command", bridge: portal }, "Alice")).toBe(
            "Send command to the Telegram bridge",
        );
        expect(bridgeSendTitle({ kind: "relay", bridge: portal }, "Alice")).toBe("Send to Alice on Telegram");
        expect(bridgeSendTitle({ kind: "none" }, "Alice")).toBeUndefined();
    });
});
