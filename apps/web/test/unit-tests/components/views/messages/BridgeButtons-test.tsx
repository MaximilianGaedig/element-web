/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React from "react";
import { type MatrixClient, type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { render, screen, waitFor, within } from "jest-matrix-react";
import userEvent from "@testing-library/user-event";
import { mocked } from "jest-mock";

import { getMockClientWithEventEmitter, mkMessage, mkEvent } from "../../../../test-utils";
import BridgeButtons from "../../../../../src/components/views/messages/BridgeButtons";
import MatrixClientContext from "../../../../../src/contexts/MatrixClientContext";
import { copyPlaintext } from "../../../../../src/utils/strings";
import dis from "../../../../../src/dispatcher/dispatcher";
import { Action } from "../../../../../src/dispatcher/actions";
import { TimelineRenderingType } from "../../../../../src/contexts/RoomContext";
import Modal, { type ComponentType, type IHandle } from "../../../../../src/Modal";
import { parseBridgeButtons, parseBridgeKeyboard } from "../../../../../src/utils/BridgeButtons";

jest.mock("../../../../../src/utils/strings", () => ({
    ...jest.requireActual("../../../../../src/utils/strings"),
    copyPlaintext: jest.fn(),
}));

const roomId = "!room:example.com";

describe("<BridgeButtons />", () => {
    let client: MatrixClient;

    beforeEach(() => {
        client = getMockClientWithEventEmitter({
            sendTextMessage: jest.fn().mockResolvedValue({ event_id: "$sent" }),
            getRoom: jest.fn().mockReturnValue(null),
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
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

    describe("button types", () => {
        const renderOne = (button: Record<string, unknown>): ReturnType<typeof render> =>
            renderButtons(mkButtonsEvent({ message_id: 7, rows: [[button]] }));

        it("renders a requires_password callback button disabled, with an explanation", async () => {
            const user = userEvent.setup();
            renderOne({ text: "Transfer", type: "callback", command: "!tg click 7 0 0", requires_password: true });

            const button = screen.getByRole("button", { name: "Transfer" });
            expect(button).toHaveAttribute("aria-disabled", "true");
            await user.hover(button);
            expect(await screen.findByRole("tooltip")).toHaveTextContent(/needs your Telegram password/);
            await user.click(button);
            expect(client.sendTextMessage).not.toHaveBeenCalled();
        });

        it("sends a reply button's text", async () => {
            const user = userEvent.setup();
            renderOne({ text: "Hello bot", type: "reply" });
            await user.click(screen.getByRole("button", { name: "Hello bot" }));
            expect(client.sendTextMessage).toHaveBeenCalledWith(roomId, null, "Hello bot");
        });

        it("copies copy_text to the clipboard and says so", async () => {
            const user = userEvent.setup();
            mocked(copyPlaintext).mockResolvedValue(true);
            renderOne({ text: "Copy code", type: "copy", copy_text: "SECRET-123" });

            await user.click(screen.getByRole("button", { name: "Copy code" }));
            expect(copyPlaintext).toHaveBeenCalledWith("SECRET-123");
            expect(await screen.findByRole("tooltip")).toHaveTextContent("Copied!");
            expect(client.sendTextMessage).not.toHaveBeenCalled();
        });

        it.each([
            ["with a bot username", { query: "cats", bot_username: "gif" }, "@gif cats"],
            ["without a bot username", { query: "cats" }, "cats"],
        ])("inserts a switch_inline query into the composer %s", async (_n, fields, expected) => {
            const user = userEvent.setup();
            const spy = jest.spyOn(dis, "dispatch");
            renderOne({ text: "Search", type: "switch_inline", same_peer: true, ...fields });

            await user.click(screen.getByRole("button", { name: "Search" }));
            expect(spy).toHaveBeenCalledWith({
                action: Action.ComposerInsert,
                text: expected,
                timelineRenderingType: TimelineRenderingType.Room,
            });
            expect(client.sendTextMessage).not.toHaveBeenCalled();
        });

        it("opens the user_profile target in the user info panel", async () => {
            const user = userEvent.setup();
            const spy = jest.spyOn(dis, "dispatch");
            renderOne({ text: "Profile", type: "user_profile", user_mxid: "@telegram_42:example.com" });

            await user.click(screen.getByRole("button", { name: "Profile" }));
            expect(spy).toHaveBeenCalledWith(
                expect.objectContaining({
                    action: Action.ViewUser,
                    member: expect.objectContaining({ userId: "@telegram_42:example.com" }),
                }),
            );
        });

        it.each([
            ["url_auth", /login link/],
            ["game", /game/],
            ["webview", /web app/],
            ["simple_webview", /web app/],
            ["request_geo", /location/],
            ["request_poll", /poll/],
            ["request_peer", /Telegram app/],
        ])("sends the command of a %s button, with a hint", async (type, hint) => {
            const user = userEvent.setup();
            renderOne({ text: "Press", type, command: "!tg click 7 0 0", url: "https://example.com" });

            const button = screen.getByRole("button", { name: "Press" });
            await user.hover(button);
            expect(await screen.findByRole("tooltip")).toHaveTextContent(hint);
            await user.click(button);
            expect(client.sendTextMessage).toHaveBeenCalledTimes(1);
            expect(client.sendTextMessage).toHaveBeenCalledWith(roomId, null, "!tg click 7 0 0");
        });

        it.each([
            [true, 1],
            [false, 0],
        ])("only sends a request_phone command once confirmed (confirmed: %s)", async (confirmed, calls) => {
            const user = userEvent.setup();
            const spy = jest.spyOn(Modal, "createDialog").mockReturnValue({
                finished: Promise.resolve([confirmed]),
                close: jest.fn(),
            } as unknown as IHandle<ComponentType>);
            renderOne({ text: "Share phone", type: "request_phone", command: "!tg click 7 0 0" });

            await user.click(screen.getByRole("button", { name: "Share phone" }));
            expect(spy).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ title: "Share your phone number?" }),
            );
            await waitFor(() => expect(client.sendTextMessage).toHaveBeenCalledTimes(calls));
            expect(mocked(client.sendTextMessage).mock.calls).toEqual(calls ? [[roomId, null, "!tg click 7 0 0"]] : []);
        });

        it.each([
            ["buy", { type: "buy" }],
            ["unsupported", { type: "unsupported" }],
            ["an unknown type", { type: "brand_new_thing", command: "!tg click 7 0 0" }],
            ["copy without copy_text", { type: "copy" }],
            ["user_profile without user_mxid", { type: "user_profile" }],
            ["switch_inline with nothing to insert", { type: "switch_inline" }],
            ["a command type without command", { type: "webview" }],
        ])("renders %s disabled", async (_n, fields) => {
            const user = userEvent.setup();
            renderOne({ text: "Nope", ...fields });
            const button = screen.getByRole("button", { name: "Nope" });
            expect(button).toHaveAttribute("aria-disabled", "true");
            await user.click(button);
            expect(client.sendTextMessage).not.toHaveBeenCalled();
        });
    });

    describe("keyboard kinds", () => {
        it.each(["reply", "hide", "force_reply"])("does not render a %s keyboard under the message", (keyboard) => {
            const { container } = renderButtons(
                mkButtonsEvent({ message_id: 1, keyboard, rows: [[{ text: "Yes", type: "reply" }]] }),
            );
            expect(container).toBeEmptyDOMElement();
        });

        it("renders an explicit inline keyboard", () => {
            renderButtons(
                mkButtonsEvent({ keyboard: "inline", rows: [[{ text: "Go", type: "callback", command: "!tg c" }]] }),
            );
            expect(screen.getByRole("button", { name: "Go" })).toBeInTheDocument();
        });

        it("parses reply keyboard options and never throws on garbage", () => {
            const content = {
                "fi.mau.telegram.buttons": {
                    keyboard: "reply",
                    rows: [[{ text: "A", type: "reply" }], "junk", [null, 3, { type: "reply" }]],
                    resize: true,
                    single_use: true,
                    placeholder: "Pick",
                    selective: "yes",
                },
            };
            expect(parseBridgeKeyboard(content)).toEqual({
                keyboard: "reply",
                rows: [[{ type: "reply", text: "A" }]],
                resize: true,
                singleUse: true,
                placeholder: "Pick",
                selective: false,
            });
            expect(parseBridgeKeyboard({ "fi.mau.telegram.buttons": { keyboard: "hide" } })?.keyboard).toBe("hide");
            expect(parseBridgeKeyboard({ "fi.mau.telegram.buttons": { keyboard: "reply", rows: [] } })).toBeNull();
            expect(parseBridgeKeyboard({ "fi.mau.telegram.buttons": { keyboard: 42 } })).toBeNull();
            expect(parseBridgeKeyboard({ "fi.mau.telegram.buttons": [] })).toBeNull();
            const evil = Object.defineProperty({}, "fi.mau.telegram.buttons", {
                get: (): never => {
                    throw new Error("boom");
                },
            });
            expect(parseBridgeKeyboard(evil)).toBeNull();
            expect(parseBridgeButtons(evil)).toBeNull();
        });
    });
});
