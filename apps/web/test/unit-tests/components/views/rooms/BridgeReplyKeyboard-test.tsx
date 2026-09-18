/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React from "react";
import { type MatrixClient, type MatrixEvent, Room, THREAD_RELATION_TYPE } from "matrix-js-sdk/src/matrix";
import { act, render, screen, within } from "jest-matrix-react";
import userEvent from "@testing-library/user-event";
import { mocked } from "jest-mock";

import { mkEvent, stubClient } from "../../../../test-utils";
import BridgeReplyKeyboard, {
    resetUsedBridgeKeyboards,
} from "../../../../../src/components/views/rooms/BridgeReplyKeyboard";
import MessageComposer from "../../../../../src/components/views/rooms/MessageComposer";
import MatrixClientContext from "../../../../../src/contexts/MatrixClientContext";
import { ScopedRoomContextProvider } from "../../../../../src/contexts/ScopedRoomContext";
import { type RoomContextType, TimelineRenderingType } from "../../../../../src/contexts/RoomContext";
import ResizeNotifier from "../../../../../src/utils/ResizeNotifier";
import { findActiveReplyKeyboard } from "../../../../../src/utils/BridgeButtons";

const roomId = "!bot:example.com";
const bot = "@telegram_123:example.com";
let evCounter = 0;

function mkBotMessage(buttons: unknown, extra: Record<string, unknown> = {}, sender = bot): MatrixEvent {
    return mkEvent({
        type: "m.room.message",
        room: roomId,
        user: sender,
        id: `$ev${++evCounter}`,
        content: {
            msgtype: "m.text",
            body: "bot says",
            ...extra,
            ...(buttons === undefined ? {} : { "fi.mau.telegram.buttons": buttons }),
        },
        event: true,
    });
}

const replyKb = (labels: string[], extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    message_id: 1,
    keyboard: "reply",
    rows: [labels.map((text) => ({ text, type: "reply" }))],
    ...extra,
});

describe("findActiveReplyKeyboard", () => {
    const me = "@me:example.com";

    it("lets the latest reply/hide/force_reply event win and ignores inline keyboards", () => {
        const a = mkBotMessage(replyKb(["A"]));
        const b = mkBotMessage(replyKb(["B"]));
        const inline = mkBotMessage({ rows: [[{ text: "I", type: "callback", command: "!tg click 1 0 0" }]] });
        expect(findActiveReplyKeyboard([a, b, inline], me)?.event).toBe(b);
        expect(findActiveReplyKeyboard([a, b, mkBotMessage({ keyboard: "hide" })], me)).toBeNull();
        expect(findActiveReplyKeyboard([mkBotMessage({ keyboard: "hide" }), a], me)?.event).toBe(a);
    });

    it("ignores keyboards sent in threads", () => {
        const main = mkBotMessage(replyKb(["Main"]));
        const inThread = mkBotMessage(replyKb(["Thread"]), {
            "m.relates_to": { rel_type: THREAD_RELATION_TYPE.name, event_id: main.getId() },
        });
        expect(findActiveReplyKeyboard([main, inThread], me)?.event).toBe(main);
    });

    it("drops a force_reply once the user sent a message after it", () => {
        const fr = mkBotMessage({ keyboard: "force_reply", placeholder: "Your name?" });
        expect(findActiveReplyKeyboard([fr], me)?.keyboard.placeholder).toBe("Your name?");
        expect(findActiveReplyKeyboard([fr, mkBotMessage(undefined, {}, me)], me)).toBeNull();
    });

    it("never throws on garbage", () => {
        expect(findActiveReplyKeyboard([null as unknown as MatrixEvent, mkBotMessage("nope")], me)).toBeNull();
        expect(findActiveReplyKeyboard([mkBotMessage({ keyboard: "bogus", rows: [] })], me)).toBeNull();
    });
});

describe("<BridgeReplyKeyboard />", () => {
    let client: MatrixClient;
    let room: Room;

    beforeEach(() => {
        resetUsedBridgeKeyboards();
        client = stubClient();
        mocked(client.sendTextMessage).mockResolvedValue({ event_id: "$sent" });
        room = new Room(roomId, client, client.getSafeUserId());
    });

    const addEvents = async (...events: MatrixEvent[]): Promise<void> => {
        await act(() => room.addLiveEvents(events, { addToState: false }));
    };

    const renderPanel = (onPlaceholderChange = jest.fn()): ReturnType<typeof render> =>
        render(
            <MatrixClientContext.Provider value={client}>
                <BridgeReplyKeyboard room={room} onPlaceholderChange={onPlaceholderChange} />
            </MatrixClientContext.Provider>,
        );

    it("renders nothing without any keyboard", async () => {
        await addEvents(mkBotMessage(undefined));
        const { container } = renderPanel();
        expect(container).toBeEmptyDOMElement();
    });

    it("shows the latest reply keyboard and live-updates (latest wins, hide removes it)", async () => {
        await addEvents(mkBotMessage(replyKb(["Old"])), mkBotMessage(replyKb(["New 1", "New 2"])));
        const { container } = renderPanel();

        const panel = screen.getByRole("group", { name: "Bot keyboard" });
        expect(within(panel).getByRole("button", { name: "New 1" })).toBeInTheDocument();
        expect(within(panel).getByRole("button", { name: "New 2" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Old" })).not.toBeInTheDocument();

        // An inline keyboard arriving later doesn't affect the reply keyboard.
        await addEvents(mkBotMessage({ rows: [[{ text: "Inline", type: "callback", command: "!tg x" }]] }));
        expect(screen.getByRole("button", { name: "New 1" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Inline" })).not.toBeInTheDocument();

        await addEvents(mkBotMessage({ message_id: 2, keyboard: "hide" }));
        expect(container).toBeEmptyDOMElement();

        await addEvents(mkBotMessage(replyKb(["Newest"])));
        expect(screen.getByRole("button", { name: "Newest" })).toBeInTheDocument();
    });

    it("sends the button text as a plain message to the main timeline", async () => {
        const user = userEvent.setup();
        await addEvents(mkBotMessage(replyKb(["Yes", "No"])));
        renderPanel();

        await user.click(screen.getByRole("button", { name: "Yes" }));
        expect(client.sendTextMessage).toHaveBeenCalledTimes(1);
        expect(client.sendTextMessage).toHaveBeenCalledWith(roomId, null, "Yes");
        // A normal (non single-use) keyboard stays visible.
        expect(screen.getByRole("button", { name: "No" })).toBeInTheDocument();
    });

    it("hides a single_use keyboard after one press, also across remounts", async () => {
        const user = userEvent.setup();
        await addEvents(mkBotMessage(replyKb(["Once"], { single_use: true, placeholder: "Pick one" })));
        const onPlaceholderChange = jest.fn();
        const { container, unmount } = renderPanel(onPlaceholderChange);
        expect(onPlaceholderChange).toHaveBeenLastCalledWith("Pick one");

        await user.click(screen.getByRole("button", { name: "Once" }));
        expect(client.sendTextMessage).toHaveBeenCalledWith(roomId, null, "Once");
        expect(container).toBeEmptyDOMElement();
        expect(onPlaceholderChange).toHaveBeenLastCalledWith(undefined);

        unmount();
        const { container: container2 } = renderPanel();
        expect(container2).toBeEmptyDOMElement();
    });

    it("can be collapsed and expanded", async () => {
        const user = userEvent.setup();
        await addEvents(mkBotMessage(replyKb(["A"])));
        renderPanel();

        const toggle = screen.getByRole("button", { name: "Hide bot keyboard" });
        expect(toggle).toHaveAttribute("aria-expanded", "true");
        await user.click(toggle);
        expect(screen.queryByRole("button", { name: "A" })).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Show bot keyboard" }));
        expect(screen.getByRole("button", { name: "A" })).toBeInTheDocument();
    });

    it("marks resize keyboards as compact", async () => {
        await addEvents(mkBotMessage(replyKb(["A"], { resize: true })));
        renderPanel();
        expect(screen.getByRole("group", { name: "Bot keyboard" })).toHaveClass("mx_BridgeReplyKeyboard_resize");
    });

    it("force_reply only sets the placeholder, until the user replies", async () => {
        await addEvents(mkBotMessage({ message_id: 3, keyboard: "force_reply", placeholder: "Your name?" }));
        const onPlaceholderChange = jest.fn();
        const { container } = renderPanel(onPlaceholderChange);
        expect(container).toBeEmptyDOMElement();
        expect(onPlaceholderChange).toHaveBeenLastCalledWith("Your name?");

        await addEvents(mkBotMessage(undefined, {}, client.getSafeUserId()));
        expect(onPlaceholderChange).toHaveBeenLastCalledWith(undefined);
    });

    it("ignores a reply keyboard sent in a thread", async () => {
        const root = mkBotMessage(undefined);
        await addEvents(root);
        const threadEv = mkBotMessage(replyKb(["Threaded"]), {
            "m.relates_to": { rel_type: THREAD_RELATION_TYPE.name, event_id: root.getId() },
        });
        // Force it into the main live timeline to make sure it's filtered by us, not just by the SDK.
        room.getLiveTimeline().addEvent(threadEv, { toStartOfTimeline: false, addToState: false });
        const { container } = renderPanel();
        expect(container).toBeEmptyDOMElement();
    });

    describe("in MessageComposer", () => {
        const renderComposer = (
            timelineRenderingType: TimelineRenderingType,
            props: Partial<React.ComponentProps<typeof MessageComposer>> = {},
        ): ReturnType<typeof render> => {
            const context = { room, canSendMessages: true, timelineRenderingType } as unknown as RoomContextType;
            return render(
                <MatrixClientContext.Provider value={client}>
                    <ScopedRoomContextProvider {...context}>
                        <MessageComposer room={room} resizeNotifier={new ResizeNotifier()} {...props} />
                    </ScopedRoomContextProvider>
                </MatrixClientContext.Provider>,
            );
        };

        it("shows the keyboard and its placeholder above the main composer", async () => {
            await addEvents(mkBotMessage(replyKb(["Go"], { placeholder: "Ask the bot" })));
            renderComposer(TimelineRenderingType.Room);
            expect(screen.getByRole("button", { name: "Go" })).toBeInTheDocument();
            expect(screen.getByLabelText("Ask the bot")).toBeInTheDocument();
        });

        it("does not show the keyboard in a thread composer", async () => {
            const root = mkBotMessage(replyKb(["Go"], { placeholder: "Ask the bot" }));
            await addEvents(root);
            renderComposer(TimelineRenderingType.Thread, {
                relation: { rel_type: THREAD_RELATION_TYPE.name, event_id: root.getId()! },
            });
            expect(screen.queryByRole("group", { name: "Bot keyboard" })).not.toBeInTheDocument();
            expect(screen.queryByRole("button", { name: "Go" })).not.toBeInTheDocument();
            expect(screen.queryByLabelText("Ask the bot")).not.toBeInTheDocument();
        });
    });
});
