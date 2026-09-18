/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "test-utils-rtl";
import { type MatrixClient, PendingEventOrdering, Room } from "matrix-js-sdk/src/matrix";

import BeeperStickerPicker from "./BeeperStickerPicker";
import MatrixClientContext from "../../../contexts/MatrixClientContext";
import { SDKContext } from "../../../contexts/SDKContext";
import { SDKContextClass } from "../../../contexts/SDKContextClass";
import { loadStickerPacks, parseStickerPack } from "../../../utils/beeper/imagePacks";
import { stubClient } from "test-utils";

vi.mock("../../../utils/beeper/imagePacks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../utils/beeper/imagePacks")>()),
    loadStickerPacks: vi.fn(),
}));

const BRIDGED = { network: "telegram", id: "42", emoji: "😀", pack_url: "https://t.me/addstickers/Cherry" };

const CHERRY = parseStickerPack(
    "room:!space:x/Cherry",
    {
        images: {
            Cherry_grinning: {
                url: "mxc://x/grin",
                body: "😀",
                info: { "mimetype": "video/webm", "w": 512, "h": 512, "fi.mau.bridged_sticker": BRIDGED },
            },
            Cherry_heart: { url: "mxc://x/heart", body: "❤️", info: { mimetype: "image/png", w: 512, h: 512 } },
        },
        pack: { display_name: "Cherry", usage: ["sticker"] },
    },
    "f",
)!;
const DOGS = parseStickerPack(
    "user",
    { images: { dog_wave: { url: "mxc://x/dog", body: "dog wave", info: { mimetype: "image/webp" } } } },
    "Dogs",
)!;

describe("BeeperStickerPicker", () => {
    let client: MatrixClient;
    let room: Room;
    const setOpen = vi.fn();

    beforeEach(() => {
        client = stubClient();
        room = new Room("!dm:x", client, client.getSafeUserId(), {
            pendingEventOrdering: PendingEventOrdering.Detached,
        });
        vi.spyOn(client, "sendEvent").mockResolvedValue({ event_id: "$sticker" });
        setOpen.mockReset();
        // Report every observed sticker as visible, so previews mount.
        vi.stubGlobal(
            "IntersectionObserver",
            class {
                public constructor(private readonly cb: IntersectionObserverCallback) {}
                public observe(target: Element): void {
                    this.cb([{ isIntersecting: true, target } as IntersectionObserverEntry], this as any);
                }
                public disconnect(): void {}
            },
        );
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const renderPicker = (open = true): ReturnType<typeof render> =>
        render(
            <SDKContext.Provider value={SDKContextClass.instance}>
                <MatrixClientContext.Provider value={client}>
                    <BeeperStickerPicker
                        room={room}
                        threadId={null}
                        isStickerPickerOpen={open}
                        setStickerPickerOpen={setOpen}
                    />
                </MatrixClientContext.Provider>
            </SDKContext.Provider>,
        );

    it("shows packs as tabs, searches and sends the ORIGINAL bridged sticker", async () => {
        vi.mocked(loadStickerPacks).mockResolvedValue([CHERRY, DOGS]);
        const { container } = renderPicker();
        await screen.findByRole("tablist");

        // Animated (webm) stickers preview as looping video.
        const video = container.querySelector<HTMLVideoElement>("video.mx_BeeperStickerPicker_media")!;
        expect(video).toBeInTheDocument();
        expect(video.loop).toBe(true);
        expect(screen.getAllByRole("tab")).toHaveLength(2);

        fireEvent.click(screen.getByRole("tab", { name: "Dogs" }));
        expect(screen.getByRole("button", { name: "dog wave" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "😀" })).not.toBeInTheDocument();

        fireEvent.change(screen.getByRole("searchbox"), { target: { value: "grin" } });
        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "😀" }));
        });
        expect(client.sendEvent).toHaveBeenCalledWith("!dm:x", null, "m.sticker", {
            body: "😀",
            url: "mxc://x/grin",
            info: { "mimetype": "video/webm", "w": 512, "h": 512, "fi.mau.bridged_sticker": BRIDGED },
        });
        expect(setOpen).toHaveBeenCalledWith(false);
    });

    it("falls back to Element's integration-manager picker without packs", async () => {
        vi.mocked(loadStickerPacks).mockResolvedValue([]);
        renderPicker();
        await waitFor(() => expect(screen.queryByRole("searchbox")).not.toBeInTheDocument());
        expect(screen.getByText(/You don't currently have any stickerpacks enabled/)).toBeInTheDocument();
    });

    it("loads nothing while closed", () => {
        vi.mocked(loadStickerPacks).mockClear();
        renderPicker(false);
        expect(loadStickerPacks).not.toHaveBeenCalled();
    });
});
