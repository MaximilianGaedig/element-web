/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React from "react";
import { composeStories } from "@storybook/react-vite";
import { fireEvent, render, screen } from "@test-utils";
import { describe, expect, it, vi } from "vitest";

import { MockViewModel } from "../../../../../core/viewmodel/MockViewModel";
import * as stories from "./VideoBodyView.stories";
import {
    VideoBodyView,
    VideoBodyViewState,
    type VideoBodyViewActions,
    type VideoBodyViewSnapshot,
} from "./VideoBodyView";

const { Ready, Hidden, ErrorState } = composeStories(stories);

class TestVideoBodyViewModel extends MockViewModel<VideoBodyViewSnapshot> implements VideoBodyViewActions {
    public onPreviewClick?: VideoBodyViewActions["onPreviewClick"];
    public onPlay?: VideoBodyViewActions["onPlay"];

    public constructor(snapshot: VideoBodyViewSnapshot, actions: VideoBodyViewActions = {}) {
        super(snapshot);
        this.onPreviewClick = actions.onPreviewClick;
        this.onPlay = actions.onPlay;
    }
}

describe("VideoBodyView", () => {
    it.each([
        ["ready", Ready],
        ["hidden", Hidden],
        ["error", ErrorState],
    ])("matches snapshot for %s story", (_name, Story) => {
        const { container } = render(<Story />);
        expect(container).toMatchSnapshot();
    });

    it("renders the hidden preview button and wires the click handler", () => {
        const onPreviewClick = vi.fn();
        const vm = new TestVideoBodyViewModel(
            {
                state: VideoBodyViewState.HIDDEN,
                hiddenButtonLabel: "Show video",
                maxWidth: 320,
                maxHeight: 180,
                aspectRatio: "16/9",
            },
            { onPreviewClick },
        );

        render(<VideoBodyView vm={vm} />);

        fireEvent.click(screen.getByRole("button", { name: "Show video" }));
        expect(onPreviewClick).toHaveBeenCalledTimes(1);
    });

    it("renders a loading spinner while the media is being prepared", () => {
        const vm = new TestVideoBodyViewModel({
            state: VideoBodyViewState.LOADING,
            maxWidth: 320,
            maxHeight: 180,
            aspectRatio: "16/9",
        });

        render(<VideoBodyView vm={vm} />);

        expect(screen.getByRole("progressbar")).toBeInTheDocument();
    });

    it("renders an error message when media processing fails", () => {
        const vm = new TestVideoBodyViewModel({
            state: VideoBodyViewState.ERROR,
            errorLabel: "Error decrypting video",
        });

        render(<VideoBodyView vm={vm} />);

        expect(screen.getByText("Error decrypting video")).toBeInTheDocument();
    });

    it("renders a video element with the expected attributes and file body content", () => {
        const onPlay = vi.fn();
        const vm = new TestVideoBodyViewModel(
            {
                state: VideoBodyViewState.READY,
                videoLabel: "Product demo video",
                maxWidth: 320,
                maxHeight: 180,
                aspectRatio: "16/9",
                src: "https://example.org/demo.mp4",
                poster: "https://example.org/demo-poster.jpg",
                preload: "none",
                controls: true,
                muted: true,
                autoPlay: true,
            },
            { onPlay },
        );

        const videoRef = React.createRef<HTMLVideoElement>();
        render(
            <VideoBodyView vm={vm} videoRef={videoRef}>
                <div>File body slot</div>
            </VideoBodyView>,
        );

        const video = screen.getByLabelText("Product demo video") as HTMLVideoElement;
        expect(video).toHaveStyle({ position: "relative" });
        expect(video).toHaveAttribute("src", "https://example.org/demo.mp4");
        expect(video).toHaveAttribute("poster", "https://example.org/demo-poster.jpg");
        expect(video).toHaveAttribute("preload", "none");
        expect(video).toHaveAttribute("controlslist", "nodownload");
        expect(video).toHaveAttribute("crossorigin", "anonymous");
        expect(video.muted).toBe(true);
        expect(video.autoplay).toBe(true);
        expect(videoRef.current).toBe(video);
        expect(screen.getByText("File body slot")).toBeInTheDocument();

        fireEvent.play(video);
        expect(onPlay).toHaveBeenCalledTimes(1);
    });

    // As in Telegram: a video playing by itself plays only while it can be seen.
    it("pauses an autoplaying video off screen and plays it again on screen", () => {
        let report: (visible: boolean) => void = () => {};
        vi.stubGlobal(
            "IntersectionObserver",
            class {
                public constructor(callback: IntersectionObserverCallback) {
                    report = (visible) =>
                        callback([{ isIntersecting: visible } as IntersectionObserverEntry], this as never);
                }
                public observe(): void {}
                public disconnect(): void {}
            },
        );
        const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
        const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
        let paused = false;
        vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockImplementation(() => paused);
        const vm = new TestVideoBodyViewModel({
            state: VideoBodyViewState.READY,
            videoLabel: "Clip",
            src: "https://example.org/clip.mp4",
            preload: "none",
            controls: true,
            muted: true,
            autoPlay: true,
        });
        render(<VideoBodyView vm={vm} />);

        report(false);
        expect(pause).toHaveBeenCalledTimes(1);
        paused = true;

        report(true);
        expect(play).toHaveBeenCalledTimes(1);
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });
});
