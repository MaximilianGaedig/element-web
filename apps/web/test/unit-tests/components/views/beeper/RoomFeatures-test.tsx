/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React from "react";
import { render, screen } from "jest-matrix-react";
import userEvent from "@testing-library/user-event";
import { type MatrixClient, type MatrixEvent, PendingEventOrdering, Room } from "matrix-js-sdk/src/matrix";

import { MatrixClientPeg } from "../../../../../src/MatrixClientPeg";
import Modal from "../../../../../src/Modal";
import { canEditContent } from "../../../../../src/utils/EventUtils";
import MessageComposerFormatBar, {
    Formatting,
} from "../../../../../src/components/views/rooms/MessageComposerFormatBar";
import ReactionPicker from "../../../../../src/components/views/emojipicker/ReactionPicker";
import { ScopedRoomContextProvider } from "../../../../../src/contexts/ScopedRoomContext";
import { getRoomContext, mkEvent, stubClient } from "../../../../test-utils";
import {
    deleteBlockedReason,
    editBlockedReason,
    fileBlockedReason,
    formattingDisabledReasons,
    isReactionAllowed,
    ROOM_FEATURES_EVENT_TYPE,
} from "../../../../../src/utils/beeper/roomFeatures";
import { dropUnsupportedBridgeFiles } from "../../../../../src/utils/beeper/unsupportedFiles";
import { bridgeBlockedActions } from "../../../../../src/components/views/beeper/BeeperBlockedActionOptions";

const ROOM_ID = "!portal:example.org";
const NOW = 1_700_000_000_000;

const TELEGRAM_LIKE = {
    formatting: { bold: 2, italic: 2, strikethrough: 2, inline_code: 2, code_block: 2, inline_link: 2 },
    file: {
        "m.image": { mime_types: { "image/jpeg": 2, "image/png": 1 }, max_size: 10 * 1024 * 1024 },
        "m.file": { mime_types: { "*/*": 2 }, max_size: 2 * 1024 * 1024 * 1024 },
    },
    edit: 2,
    edit_max_age: 48 * 3600,
    delete: 2,
    reaction: 2,
    allowed_reactions: ["👍", "❤️", "🔥"],
};

describe("com.beeper.room_features", () => {
    let client: MatrixClient;
    let room: Room;

    const setFeatures = (content: Record<string, unknown>): void => {
        room.currentState.setStateEvents([
            mkEvent({
                event: true,
                type: "m.bridge",
                skey: "telegram",
                room: ROOM_ID,
                user: "@bot:x",
                content: {
                    protocol: { id: "telegram", displayname: "Telegram" },
                },
            }),
            mkEvent({
                event: true,
                type: ROOM_FEATURES_EVENT_TYPE,
                skey: "telegram",
                room: ROOM_ID,
                user: "@bot:x",
                content,
            }),
        ]);
    };

    const mkMine = (ts = NOW): MatrixEvent => {
        const ev = mkEvent({
            event: true,
            type: "m.room.message",
            room: ROOM_ID,
            user: client.getSafeUserId(),
            ts,
            content: { msgtype: "m.text", body: "mine" },
        });
        ev.setStatus(null);
        return ev;
    };

    beforeEach(() => {
        jest.useFakeTimers({ now: NOW });
        stubClient();
        client = MatrixClientPeg.safeGet();
        room = new Room(ROOM_ID, client, client.getSafeUserId(), {
            pendingEventOrdering: PendingEventOrdering.Detached,
        });
        jest.spyOn(client, "getRoom").mockReturnValue(room);
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it("does not restrict rooms without room_features", () => {
        const ev = mkMine(NOW - 365 * 86_400_000);
        expect(editBlockedReason(ev, room)).toBeUndefined();
        expect(deleteBlockedReason(ev, room)).toBeUndefined();
        expect(isReactionAllowed(room, "🦆")).toBe(true);
        expect(formattingDisabledReasons(room)).toEqual({});
        expect(canEditContent(client, ev)).toBe(true);
    });

    it("blocks editing past edit_max_age, and hides the edit action", () => {
        setFeatures(TELEGRAM_LIKE);
        expect(canEditContent(client, mkMine(NOW - 3600_000))).toBe(true);
        const old = mkMine(NOW - 49 * 3600_000);
        expect(editBlockedReason(old, room)).toBe("Telegram doesn't allow editing messages this old");
        expect(canEditContent(client, old)).toBe(false);
    });

    it("blocks edits and deletes when unsupported", () => {
        setFeatures({ ...TELEGRAM_LIKE, edit: 0, delete: -2 });
        const ev = mkMine();
        expect(editBlockedReason(ev, room)).toBe("Telegram doesn't support editing messages");
        expect(deleteBlockedReason(ev, room)).toBe("Telegram doesn't support deleting messages");
    });

    it("reports bridge-blocked actions for the context menu only on our own messages", () => {
        setFeatures({ ...TELEGRAM_LIKE, edit: 0, delete: -2 });
        jest.spyOn(room.currentState, "maySendRedactionForEvent").mockReturnValue(true);
        expect(bridgeBlockedActions(client, mkMine())).toEqual({
            edit: "Telegram doesn't support editing messages",
            delete: "Telegram doesn't support deleting messages",
        });
        const theirs = mkEvent({
            event: true,
            type: "m.room.message",
            room: ROOM_ID,
            user: "@telegram_1:x",
            content: { msgtype: "m.text", body: "x" },
        });
        expect(bridgeBlockedActions(client, theirs)).toEqual({});
    });

    it("limits reactions to allowed_reactions, ignoring the variation selector", () => {
        setFeatures(TELEGRAM_LIKE);
        expect(isReactionAllowed(room, "👍")).toBe(true);
        expect(isReactionAllowed(room, "❤")).toBe(true);
        expect(isReactionAllowed(room, "🦆")).toBe(false);
        expect(isReactionAllowed(room, "mxc://x/custom")).toBe(false);
    });

    it("reaction picker disables disallowed emoji and explains why", () => {
        setFeatures({ ...TELEGRAM_LIKE, allowed_reactions: ["😀", "👍"] });
        const target = mkEvent({
            event: true,
            type: "m.room.message",
            room: ROOM_ID,
            user: "@telegram_1:x",
            content: { msgtype: "m.text", body: "hi" },
        });
        render(
            <ScopedRoomContextProvider {...getRoomContext(room, {})}>
                <ReactionPicker mxEvent={target} onFinished={jest.fn()} />
            </ScopedRoomContextProvider>,
        );
        expect(screen.getByRole("note")).toHaveTextContent("Telegram only allows these 2 reactions here");
        // The first rendered category is "Smileys & People", which starts with 😀 😃.
        const buttons = (emoji: string): HTMLElement[] =>
            screen
                .getAllByText(emoji)
                .map((el) => el.closest<HTMLElement>("[role=checkbox]"))
                .filter((el): el is HTMLElement => !!el);
        expect(buttons("😃").length).toBeGreaterThan(0);
        buttons("😃").forEach((el) => expect(el).toHaveAttribute("aria-disabled", "true"));
        buttons("😀").forEach((el) => expect(el).not.toHaveAttribute("aria-disabled"));
    });

    it("format bar disables unsupported formatting with a tooltip", async () => {
        jest.useRealTimers();
        setFeatures(TELEGRAM_LIKE); // no blockquote
        const reasons = formattingDisabledReasons(room);
        expect(Object.keys(reasons)).toEqual([Formatting.Quote]);

        const onAction = jest.fn();
        render(<MessageComposerFormatBar shortcuts={{}} onAction={onAction} disabledReasons={reasons} />);
        const quote = screen.getByRole("button", { name: "Quote" });
        expect(quote).toHaveAttribute("aria-disabled", "true");
        await userEvent.click(quote);
        expect(onAction).not.toHaveBeenCalled();
        await userEvent.hover(quote);
        expect(await screen.findByText("Quote: Not supported on Telegram")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Bold" })).not.toHaveAttribute("aria-disabled");
    });

    it("rejects file types and sizes the network doesn't accept, and tells the user", async () => {
        setFeatures(TELEGRAM_LIKE);
        const big = new File(["x"], "big.jpg", { type: "image/jpeg" });
        Object.defineProperty(big, "size", { value: 20 * 1024 * 1024 });
        const webp = new File(["x"], "sticker.webp", { type: "image/webp" });
        const ok = new File(["x"], "ok.png", { type: "image/png" });
        const doc = new File(["x"], "doc.pdf", { type: "application/pdf" });

        expect(fileBlockedReason(room, big)).toBe("too large for Telegram (max 10 MB)");
        expect(fileBlockedReason(room, webp)).toBe("Telegram doesn't accept image/webp files");
        expect(fileBlockedReason(room, ok)).toBeUndefined();
        expect(fileBlockedReason(room, doc)).toBeUndefined();

        const createDialog = jest
            .spyOn(Modal, "createDialog")
            .mockReturnValue({ finished: Promise.resolve([]), close: jest.fn() } as any);
        const files = [big, ok, webp, doc];
        await dropUnsupportedBridgeFiles(room, files);
        expect(files).toEqual([ok, doc]);
        expect(createDialog).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ title: "2 files can't be sent" }),
        );
    });
});
