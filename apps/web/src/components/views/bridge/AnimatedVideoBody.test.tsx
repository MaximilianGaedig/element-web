/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance, type Mock } from "vitest";
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "test-utils-rtl";
import { type MatrixClient, type MatrixEvent } from "matrix-js-sdk/src/matrix";

import AnimatedVideoBody from "./AnimatedVideoBody";
import MessageEvent from "../messages/MessageEvent";
import MatrixClientContext from "../../../contexts/MatrixClientContext";
import { MatrixClientPeg } from "../../../MatrixClientPeg";
import SettingsStore from "../../../settings/SettingsStore";
import Modal from "../../../Modal";
import { MediaEventHelper } from "../../../utils/MediaEventHelper";
import { mkEvent, stubClient } from "test-utils";
import { fitSize, getAnimatedVideoHints, isAnimatedSticker } from "../../../utils/bridge/animatedMedia";

const ROOM_ID = "!portal:example.org";

// A real Telegram animated sticker as bridged by mautrix-telegram.
const STICKER_INFO = {
    "mimetype": "video/webm",
    "w": 256,
    "h": 256,
    "duration": 2900,
    "size": 12345,
    "thumbnail_url": "mxc://example.org/thumb",
    "fi.mau.autoplay": true,
    "fi.mau.loop": true,
    "fi.mau.hide_controls": true,
    "fi.mau.no_audio": true,
    "fi.mau.telegram.animated_sticker": true,
    "fi.mau.bridged_sticker": {
        network: "telegram",
        id: "123",
        emoji: "😼",
        pack_url: "https://t.me/addstickers/cats",
    },
};

const GIF_INFO = {
    "mimetype": "video/mp4",
    "w": 640,
    "h": 320,
    "fi.mau.autoplay": true,
    "fi.mau.loop": true,
    "fi.mau.gif": true,
    "fi.mau.no_audio": true,
};

describe("bridged GIFs and animated stickers", () => {
    let client: MatrixClient;
    let settings: Record<string, unknown>;
    let observerCallback: IntersectionObserverCallback | undefined;
    let play: MockInstance;
    let pause: MockInstance;

    const mkVideo = (info: Record<string, unknown>, body = "sticker.webm"): MatrixEvent =>
        mkEvent({
            event: true,
            type: "m.room.message",
            room: ROOM_ID,
            user: "@telegram_1:example.org",
            content: { msgtype: "m.video", body, url: "mxc://example.org/video", info },
        });

    const renderBody = (ev: MatrixEvent): ReturnType<typeof render> =>
        render(
            <MatrixClientContext.Provider value={client}>
                <AnimatedVideoBody
                    mxEvent={ev}
                    mediaEventHelper={new MediaEventHelper(ev)}
                    onMessageAllowed={vi.fn()}
                    permalinkCreator={undefined}
                />
            </MatrixClientContext.Provider>,
        );

    const setOnScreen = (isIntersecting: boolean): void =>
        act(() => observerCallback?.([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver));

    beforeEach(() => {
        stubClient();
        client = MatrixClientPeg.safeGet();
        vi.spyOn(client, "mxcUrlToHttp").mockImplementation((mxc) => `https://hs/${mxc}`);
        settings = {
            autoplayGifs: true,
            autoplayVideo: false,
            mediaPreviewConfig: { media_previews: "on" },
            showMediaEventIds: {},
        };
        vi.spyOn(SettingsStore, "getValue").mockImplementation((name: string) => settings[name] as any);
        // vitest mocks are only constructible with a function (not arrow) implementation.
        window.IntersectionObserver = vi.fn(function (cb: IntersectionObserverCallback) {
            observerCallback = cb;
            return { observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() };
        }) as any;
        play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
        pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
        window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as any;
    });

    afterEach(() => vi.restoreAllMocks());

    it("parses the hints; ordinary videos are left alone", () => {
        const sticker = mkVideo(STICKER_INFO);
        expect(getAnimatedVideoHints(sticker)).toMatchObject({
            autoplay: true,
            loop: true,
            sticker: true,
            bridgedSticker: { emoji: "😼", pack_url: "https://t.me/addstickers/cats" },
        });
        expect(isAnimatedSticker(sticker)).toBe(true);
        expect(isAnimatedSticker(mkVideo(GIF_INFO))).toBe(false);
        expect(getAnimatedVideoHints(mkVideo({ mimetype: "video/mp4", w: 10, h: 10 }))).toBeUndefined();
        expect(
            getAnimatedVideoHints(
                mkVideo({ ...STICKER_INFO, "fi.mau.bridged_sticker": { emoji: "x", pack_url: "javascript:alert(1)" } }),
            )?.bridgedSticker?.pack_url,
        ).toBeUndefined();
        expect(fitSize(640, 320, 320)).toEqual({ width: 320, height: 160 });
    });

    it("autoplays a muted, looping video without controls, sized like a sticker", async () => {
        const { container } = renderBody(mkVideo(STICKER_INFO));
        const video = container.querySelector("video")!;
        await waitFor(() => expect(video).toHaveAttribute("src", "https://hs/mxc://example.org/video"));
        expect(video.muted).toBe(true);
        expect(video.loop).toBe(true);
        expect(video.autoplay).toBe(true);
        expect(video).toHaveAttribute("playsinline");
        expect(video.controls).toBe(false);
        expect(video).toHaveAttribute("title", "😼");
        expect(video).toHaveAttribute("width", "256");
        expect(container.querySelector(".mx_AnimatedVideo")).toHaveClass("mx_AnimatedVideo_sticker");
        expect(screen.getByRole("link", { name: "Open sticker pack" })).toHaveAttribute(
            "href",
            "https://t.me/addstickers/cats",
        );
        await waitFor(() => expect(play).toHaveBeenCalled());
    });

    it("pauses offscreen and resumes when scrolled back", async () => {
        const { container } = renderBody(mkVideo(GIF_INFO, "cat.mp4"));
        await waitFor(() => expect(container.querySelector("video")).toHaveAttribute("src"));
        play.mockClear();
        setOnScreen(false);
        expect(pause).toHaveBeenCalled();
        setOnScreen(true);
        expect(play).toHaveBeenCalled();
    });

    it("with autoplay off shows the thumbnail and plays on hover; OS reduced motion does not block autoplay", async () => {
        settings.autoplayGifs = false;
        const { container } = renderBody(mkVideo(GIF_INFO, "cat.mp4"));
        const video = container.querySelector("video")!;
        await waitFor(() => expect(video).toHaveAttribute("src"));
        expect(video.autoplay).toBe(false);
        expect(screen.getByText("GIF")).toBeInTheDocument();
        expect(play).not.toHaveBeenCalled();

        fireEvent.mouseEnter(container.querySelector(".mx_AnimatedVideo")!);
        expect(play).toHaveBeenCalled();
        fireEvent.mouseLeave(container.querySelector(".mx_AnimatedVideo")!);
        expect(pause).toHaveBeenCalled();

        settings.autoplayGifs = true;
        (window.matchMedia as Mock).mockReturnValue({ matches: true });
        play.mockClear();
        const again = renderBody(mkVideo(GIF_INFO, "cat.mp4"));
        await waitFor(() => expect(again.container.querySelector("video")).toHaveAttribute("src"));
        // Like Element's own GIFs, only the in-app setting decides.
        expect(again.container.querySelector("video")!.autoplay).toBe(true);
        expect(play).toHaveBeenCalled();
    });

    it("opens the lightbox on click", async () => {
        const createDialog = vi.spyOn(Modal, "createDialog").mockReturnValue({} as any);
        const { container } = renderBody(mkVideo(GIF_INFO, "cat.mp4"));
        const video = container.querySelector("video")!;
        await waitFor(() => expect(video).toHaveAttribute("src"));
        fireEvent.click(video);
        expect(createDialog).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ src: "https://hs/mxc://example.org/video" }),
            "mx_Dialog_lightbox",
            undefined,
            true,
        );
    });

    it("is picked by MessageEvent for hinted videos only, without a caption for stickers", async () => {
        const render_ = (ev: MatrixEvent): ReturnType<typeof render> =>
            render(
                <MatrixClientContext.Provider value={client}>
                    <MessageEvent mxEvent={ev} permalinkCreator={undefined} />
                </MatrixClientContext.Provider>,
            );
        const sticker = mkVideo(STICKER_INFO, "😼");
        sticker.getContent().filename = "sticker.webm";
        const { container } = render_(sticker);
        expect(container.querySelector(".mx_AnimatedVideo")).toBeInTheDocument();
        expect(container.querySelector(".mx_EventTile_caption")).toBeNull();

        const plain = render_(mkVideo({ mimetype: "video/mp4", w: 10, h: 10 }, "clip.mp4"));
        expect(plain.container.querySelector(".mx_AnimatedVideo")).toBeNull();
    });

    it("plays a video m.sticker (sent from the sticker picker, no size) as a looping sticker", () => {
        const ev = mkEvent({
            event: true,
            type: "m.sticker",
            room: ROOM_ID,
            user: "@me:example.org",
            content: {
                body: "😼",
                url: "mxc://example.org/video",
                info: { "mimetype": "video/webm", "fi.mau.bridged_sticker": { network: "telegram", emoji: "😼" } },
            },
        });
        expect(getAnimatedVideoHints(ev)).toMatchObject({ autoplay: true, loop: true, sticker: true, noAudio: true });
        const { container } = render(
            <MatrixClientContext.Provider value={client}>
                <MessageEvent mxEvent={ev} permalinkCreator={undefined} />
            </MatrixClientContext.Provider>,
        );
        const box = container.querySelector<HTMLElement>(".mx_AnimatedVideo_sticker");
        expect(box).toBeInTheDocument();
        expect(box!.style.width).toBe(box!.style.height); // square fallback without info.w/h
        expect(container.querySelector("video")?.loop).toBe(true);

        // Image stickers keep Element's sticker body.
        const image = mkEvent({
            event: true,
            type: "m.sticker",
            room: ROOM_ID,
            user: "@me:example.org",
            content: { body: "x", url: "mxc://example.org/img", info: { mimetype: "image/webp", w: 10, h: 10 } },
        });
        expect(getAnimatedVideoHints(image)).toBeUndefined();
    });
});
