/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it, vi } from "vitest";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";

import {
    BRIDGE_SETTINGS_EVENT_TYPE,
    BRIDGE_SETTINGS_SET_MSGTYPE,
    type DeclaredControl,
    declaredSettings,
    isRenderable,
    requestSetting,
} from "./declaredSettings";

const control = (over: Partial<DeclaredControl> = {}): DeclaredControl => ({
    key: "backfill",
    label: "Import older messages",
    type: "action",
    value: null,
    ...over,
});

/** A client holding one room whose state carries a settings declaration. */
function clientWith(content: object, stateKey = "acct"): MatrixClient {
    const room = {
        roomId: "!mgmt:x",
        currentState: {
            getStateEvents: (type: string) =>
                type === BRIDGE_SETTINGS_EVENT_TYPE ? [{ getContent: () => content, getStateKey: () => stateKey }] : [],
        },
    };
    return { getRooms: () => [room] } as unknown as MatrixClient;
}

describe("isRenderable", () => {
    it("takes the types this client can draw", () => {
        for (const type of ["boolean", "number", "text", "action"] as const) {
            expect(isRenderable(control({ type }))).toBe(true);
        }
        expect(isRenderable(control({ type: "enum", options: [{ value: "a", label: "A" }] }))).toBe(true);
    });

    it("leaves out an enum with nothing to choose from", () => {
        // A dropdown with no options is worse than no dropdown: it looks like a control and is not one.
        expect(isRenderable(control({ type: "enum", options: [] }))).toBe(false);
        expect(isRenderable(control({ type: "enum" }))).toBe(false);
    });

    it("leaves out a type it has never heard of", () => {
        // From a newer bridge than this client. Skipped rather than guessed at, which is the whole
        // reason the type travels with the control instead of living in a table here.
        expect(isRenderable(control({ type: "colour-wheel" as never }))).toBe(false);
    });

    it("leaves out a control with nothing to show", () => {
        expect(isRenderable(control({ label: "" }))).toBe(false);
        expect(isRenderable(control({ key: "" }))).toBe(false);
    });
});

describe("declaredSettings", () => {
    it("reads a declaration out of room state, with where to send a request", () => {
        const client = clientWith({
            source: { id: "telegram", name: "Telegram" },
            settings: [control()],
        });
        const [found] = declaredSettings(client);
        expect(found.source).toEqual({ id: "telegram", name: "Telegram" });
        expect(found.settings).toHaveLength(1);
        expect(found.loginId).toBe("acct");
        // The room matters: a request has to go back to where the declaration came from.
        expect(found.roomId).toBe("!mgmt:x");
    });

    it("keeps a disabled control, because the reason is worth showing", () => {
        const client = clientWith({
            source: { id: "telegram", name: "Telegram" },
            settings: [control({ disabled_reason: "Not connected to Telegram" })],
        });
        // Dropping it would leave the user wondering where the button went; the bridge's own
        // explanation is the most useful thing on the card.
        expect(declaredSettings(client)[0].settings[0].disabled_reason).toBe("Not connected to Telegram");
    });

    it("drops a declaration with nothing renderable in it", () => {
        expect(declaredSettings(clientWith({ source: {}, settings: [control({ type: "enum" })] }))).toEqual([]);
        expect(declaredSettings(clientWith({ source: {}, settings: [] }))).toEqual([]);
    });

    it("survives a declaration that is not the shape it claims", () => {
        // Room state is whatever was written into it, by any version of any bridge.
        expect(declaredSettings(clientWith({ settings: "not a list" }))).toEqual([]);
        expect(declaredSettings(clientWith({}))).toEqual([]);
    });
});

describe("requestSetting", () => {
    const declaration = { source: { id: "t", name: "T" }, settings: [], loginId: "acct", roomId: "!mgmt:x" };

    it("sends a message, not state", async () => {
        // The user may have no power to send state, and a request is not a fact.
        const sendMessage = vi.fn().mockResolvedValue({});
        await requestSetting(
            { sendMessage } as unknown as MatrixClient,
            declaration,
            control({ type: "boolean" }),
            true,
        );
        expect(sendMessage).toHaveBeenCalledWith(
            "!mgmt:x",
            expect.objectContaining({ msgtype: BRIDGE_SETTINGS_SET_MSGTYPE, key: "backfill", value: true }),
        );
    });

    it("sends no value for an action, whatever it was handed", async () => {
        const sendMessage = vi.fn().mockResolvedValue({});
        await requestSetting({ sendMessage } as unknown as MatrixClient, declaration, control(), true);
        expect(sendMessage.mock.calls[0][1]).toMatchObject({ value: null });
    });

    it("carries a body, so a client that knows nothing of this msgtype shows something", async () => {
        const sendMessage = vi.fn().mockResolvedValue({});
        await requestSetting({ sendMessage } as unknown as MatrixClient, declaration, control(), null);
        expect(sendMessage.mock.calls[0][1].body).toContain("Import older messages");
    });

    it("refuses to ask for a control the bridge withdrew", async () => {
        const sendMessage = vi.fn();
        await expect(
            requestSetting(
                { sendMessage } as unknown as MatrixClient,
                declaration,
                control({ disabled_reason: "Not connected to Telegram" }),
                null,
            ),
        ).rejects.toThrow("Not connected to Telegram");
        // And says nothing: asking anyway earns a notice the user did not ask for.
        expect(sendMessage).not.toHaveBeenCalled();
    });
});
