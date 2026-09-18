/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React from "react";
import { type MatrixClient, type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { render, screen, waitFor, within } from "jest-matrix-react";
import userEvent from "@testing-library/user-event";

import { getMockClientWithEventEmitter, mkMessage, mkEvent } from "../../../../test-utils";
import BridgeButtons from "../../../../../src/components/views/messages/BridgeButtons";
import MatrixClientContext from "../../../../../src/contexts/MatrixClientContext";

const roomId = "!room:example.com";

describe("<BridgeButtons />", () => {
    let client: MatrixClient;

    beforeEach(() => {
        client = getMockClientWithEventEmitter({
            sendTextMessage: jest.fn().mockResolvedValue({ event_id: "$sent" }),
        });
    });

    const mkButtonsEvent = (buttons: unknown, extraContent: Record<string, unknown> = {}): MatrixEvent => {
        const ev = mkMessage({ room: roomId, user: "@sender:example.com", msg: "Choose an option", event: true });
        const content = {
            ...ev.getContent(),
            ...extraContent,
            ["fi.mau.telegram.buttons"]: buttons,
        };
        // mkMessage doesn't take arbitrary content, so patch it directly like the SDK would
        // populate it from the homeserver.
        (ev.event.content as Record<string, unknown>) = content;
        return ev;
    };

    const renderButtons = (mxEvent: MatrixEvent): ReturnType<typeof render> =>
        render(
            <MatrixClientContext.Provider value={client}>
                <BridgeButtons mxEvent={mxEvent} />
            </MatrixClientContext.Provider>,
        );

    it("renders rows of buttons", () => {
        const ev = mkButtonsEvent({
            message_id: 12345,
            rows: [
                [
                    { text: "Reject Group Transfer", type: "callback", command: "!tg click 12345 0 0" },
                    { text: "Docs", type: "url", url: "https://example.com" },
                ],
                [{ text: "Whatever", type: "unsupported" }],
            ],
        });

        const { container } = renderButtons(ev);

        const rows = container.querySelectorAll(".mx_BridgeButtons_row");
        expect(rows).toHaveLength(2);
        expect(within(rows[0] as HTMLElement).getByText("Reject Group Transfer")).toBeInTheDocument();
        expect(within(rows[0] as HTMLElement).getByText("Docs")).toBeInTheDocument();
        expect(within(rows[1] as HTMLElement).getByText("Whatever")).toBeInTheDocument();
    });

    it("sends the command exactly once when a callback button is clicked", async () => {
        const user = userEvent.setup();
        const ev = mkButtonsEvent({
            rows: [[{ text: "Reject", type: "callback", command: "!tg click 12345 0 0" }]],
        });

        renderButtons(ev);

        const button = screen.getByRole("button", { name: "Reject" });
        await user.click(button);

        expect(client.sendTextMessage).toHaveBeenCalledTimes(1);
        expect(client.sendTextMessage).toHaveBeenCalledWith(roomId, null, "!tg click 12345 0 0");

        // Button should now be disabled (pending cooldown) so a second click doesn't resend.
        await user.click(button);
        expect(client.sendTextMessage).toHaveBeenCalledTimes(1);
    });

    it("renders url buttons as real, safe links", () => {
        const ev = mkButtonsEvent({
            rows: [[{ text: "Docs", type: "url", url: "https://example.com/docs" }]],
        });

        renderButtons(ev);

        const link = screen.getByRole("link", { name: "Docs" });
        expect(link).toHaveAttribute("href", "https://example.com/docs");
        expect(link).toHaveAttribute("target", "_blank");
        expect(link).toHaveAttribute("rel", "noreferrer noopener");
    });

    it("does not set href for url buttons with a disallowed scheme", () => {
        const ev = mkButtonsEvent({
            rows: [[{ text: "Evil", type: "url", url: "javascript:alert(1)" }]],
        });

        renderButtons(ev);

        const link = screen.getByRole("link", { name: "Evil" });
        expect(link).not.toHaveAttribute("href");
        expect(link).toHaveAttribute("aria-disabled", "true");
    });

    it("renders unsupported button types as disabled", () => {
        const ev = mkButtonsEvent({
            rows: [[{ text: "Whatever", type: "unsupported" }]],
        });

        renderButtons(ev);

        const button = screen.getByRole("button", { name: "Whatever" });
        expect(button).toHaveAttribute("aria-disabled", "true");
    });

    it.each([
        ["not an object", "banana"],
        ["missing rows", {}],
        ["rows not an array", { rows: "nope" }],
        ["empty rows", { rows: [] }],
        ["rows of non-arrays", { rows: ["nope"] }],
        ["buttons missing text", { rows: [[{ type: "callback", command: "!tg foo" }]] }],
    ])("renders nothing for malformed content (%s)", (_name, buttons) => {
        const ev = mkButtonsEvent(buttons);

        const { container } = renderButtons(ev);
        expect(container).toBeEmptyDOMElement();
    });

    it("renders nothing when the field is absent", () => {
        const ev = mkMessage({ room: roomId, user: "@sender:example.com", msg: "just text", event: true });
        const { container } = renderButtons(ev);
        expect(container).toBeEmptyDOMElement();
    });

    it("renders nothing for redacted events even if the field is present", () => {
        const ev = mkButtonsEvent({
            rows: [[{ text: "Reject", type: "callback", command: "!tg click 12345 0 0" }]],
        });
        jest.spyOn(ev, "isRedacted").mockReturnValue(true);

        const { container } = renderButtons(ev);
        expect(container).toBeEmptyDOMElement();
    });

    it("re-renders buttons from the edited content, and disappears when the keyboard is removed", async () => {
        const original = mkButtonsEvent({
            rows: [[{ text: "Original", type: "callback", command: "!tg click 1 0 0" }]],
        });

        const { container } = renderButtons(original);
        expect(screen.getByRole("button", { name: "Original" })).toBeInTheDocument();

        // Simulate the bridge editing the message to a new keyboard.
        const edit = mkEvent({
            type: "m.room.message",
            room: roomId,
            user: "@sender:example.com",
            content: {
                msgtype: "m.text",
                body: "* Choose an option",
                ["m.new_content"]: {
                    msgtype: "m.text",
                    body: "Choose an option",
                    ["fi.mau.telegram.buttons"]: {
                        rows: [[{ text: "Updated", type: "callback", command: "!tg click 1 0 1" }]],
                    },
                },
            },
            event: true,
        });
        original.makeReplaced(edit);

        await waitFor(() => expect(screen.getByRole("button", { name: "Updated" })).toBeInTheDocument());
        expect(screen.queryByRole("button", { name: "Original" })).not.toBeInTheDocument();

        // Now simulate the keyboard being removed entirely (edited away).
        const editRemoved = mkEvent({
            type: "m.room.message",
            room: roomId,
            user: "@sender:example.com",
            content: {
                msgtype: "m.text",
                body: "* Choose an option",
                ["m.new_content"]: {
                    msgtype: "m.text",
                    body: "Choose an option",
                },
            },
            event: true,
        });
        original.makeReplaced(editRemoved);

        await waitFor(() => expect(container).toBeEmptyDOMElement());
    });
});
