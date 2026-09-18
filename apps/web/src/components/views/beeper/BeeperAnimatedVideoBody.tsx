/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useCallback, useEffect, useRef, useState } from "react";
import classNames from "classnames";
import { logger } from "matrix-js-sdk/src/logger";

import { type IBodyProps } from "../messages/IBodyProps";
import { useMediaVisible } from "../../../hooks/useMediaVisible";
import { useSettingValue } from "../../../hooks/useSettings";
import { mediaFromContent } from "../../../customisations/Media";
import Modal from "../../../Modal";
import AccessibleButton from "../elements/AccessibleButton";
import { _t } from "../../../languageHandler";
import { type AnimatedVideoHints, fitSize, getAnimatedVideoHints } from "../../../utils/beeper/animatedMedia";
import { isTelegramLayout } from "../../../utils/beeper/telegramLayout";

const STICKER_MAX = 256;
/** Telegram Web's animated sticker box (mediaSizes.animatedSticker). */
const TELEGRAM_STICKER_MAX = 200;
const GIF_MAX = 320;

/** Resolves the (decrypted, if needed) video and thumbnail URLs of the event. */
function useMediaUrls(props: IBodyProps, load: boolean): { src?: string; poster?: string } {
    const [urls, setUrls] = useState<{ src?: string; poster?: string }>({});
    const { mxEvent, mediaEventHelper } = props;
    useEffect(() => {
        if (!load) return;
        let cancelled = false;
        (async () => {
            try {
                let src: string | null | undefined;
                let poster: string | null | undefined;
                if (mediaEventHelper) {
                    [src, poster] = await Promise.all([
                        mediaEventHelper.sourceUrl.value,
                        mediaEventHelper.thumbnailUrl.value.catch(() => null),
                    ]);
                } else {
                    const media = mediaFromContent(mxEvent.getContent());
                    src = media.srcHttp;
                    poster = media.thumbnailHttp;
                }
                if (!cancelled) setUrls({ src: src ?? undefined, poster: poster ?? undefined });
            } catch (e) {
                logger.warn("Failed to load animated video", e);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [mxEvent, mediaEventHelper, load]);
    return urls;
}

/** True while the element is (at least partly) on screen. Assumes visible without IntersectionObserver. */
function useOnScreen(ref: React.RefObject<HTMLElement | null>, mounted: boolean): boolean {
    const [onScreen, setOnScreen] = useState(true);
    useEffect(() => {
        const el = ref.current;
        if (!el || typeof IntersectionObserver === "undefined") return;
        const observer = new IntersectionObserver((entries) => {
            for (const entry of entries) setOnScreen(entry.isIntersecting);
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, [ref, mounted]);
    return onScreen;
}

interface LightboxProps {
    src: string;
    poster?: string;
    label: string;
    onFinished: () => void;
}

/** Full-size looping playback of a GIF-like video; click or Escape closes it. */
export function BeeperAnimatedVideoLightbox({ src, poster, label, onFinished }: LightboxProps): JSX.Element {
    return (
        <div
            className="mx_BeeperAnimatedVideoLightbox"
            onClick={onFinished}
            onKeyDown={(e) => e.key === "Escape" && onFinished()}
            role="dialog"
            aria-label={label}
        >
            <video src={src} poster={poster} autoPlay loop muted playsInline />
            <AccessibleButton
                className="mx_BeeperAnimatedVideoLightbox_close"
                onClick={onFinished}
                aria-label={_t("action|close")}
            >
                ×
            </AccessibleButton>
        </div>
    );
}

/**
 * Renders bridged GIFs and animated stickers (m.video with fi.mau.* playback hints) like Telegram
 * does: muted, looping, without controls. Respects the "Autoplay GIFs"/"Autoplay videos" settings
 * (when off it shows the thumbnail and plays on hover), and pauses when
 * scrolled offscreen. Stickers render without a bubble, captioned only by their emoji tooltip.
 */
export default function BeeperAnimatedVideoBody(props: IBodyProps): JSX.Element {
    const { mxEvent, forExport } = props;
    const hints = getAnimatedVideoHints(mxEvent) as AnimatedVideoHints;
    const [mediaVisible, setMediaVisible] = useMediaVisible(mxEvent);
    const autoplayGifs = useSettingValue("autoplayGifs");
    const autoplayVideo = useSettingValue("autoplayVideo");
    const gifLike = hints.gif || hints.sticker;
    // Same rule as Element's own GIFs (MImageBody): only the in-app autoplay settings decide, not the
    // OS-level prefers-reduced-motion, which many desktops set just by turning animations off.
    const autoplay = !forExport && (gifLike ? autoplayGifs : autoplayVideo);

    const containerRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const [hovered, setHovered] = useState(false);
    const onScreen = useOnScreen(containerRef, mediaVisible);
    const { src, poster } = useMediaUrls(props, mediaVisible && !forExport);

    const shouldPlay = !!src && onScreen && (autoplay || hovered);
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        if (shouldPlay) {
            video.play()?.catch?.(() => {});
        } else {
            video.pause();
            if (!autoplay) video.currentTime = 0;
        }
    }, [shouldPlay, autoplay]);

    const emoji = hints.bridgedSticker?.emoji;
    const body = mxEvent.getContent().body;
    const label = emoji ?? (typeof body === "string" ? body : "");

    const openLightbox = useCallback(() => {
        if (!src) return;
        Modal.createDialog(BeeperAnimatedVideoLightbox, { src, poster, label }, "mx_Dialog_lightbox", undefined, true);
    }, [src, poster, label]);

    const stickerMax = isTelegramLayout() ? TELEGRAM_STICKER_MAX : STICKER_MAX;
    const { width, height } = fitSize(hints.width, hints.height, hints.sticker ? stickerMax : GIF_MAX);
    const className = classNames("mx_BeeperAnimatedVideo", {
        mx_BeeperAnimatedVideo_sticker: hints.sticker,
        mx_BeeperAnimatedVideo_playing: shouldPlay,
    });

    if (!mediaVisible) {
        return (
            <div className={className} style={{ width, height }}>
                <AccessibleButton kind="link" onClick={() => setMediaVisible(true)}>
                    {hints.sticker ? _t("beeper|animated_show_sticker") : _t("beeper|animated_show_gif")}
                </AccessibleButton>
            </div>
        );
    }

    return (
        <div
            ref={containerRef}
            className={className}
            style={{ width, height }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onFocus={() => setHovered(true)}
            onBlur={() => setHovered(false)}
        >
            <video
                ref={videoRef}
                src={src}
                poster={poster}
                width={width}
                height={height}
                muted
                loop
                playsInline
                autoPlay={autoplay && onScreen}
                controls={false}
                preload={autoplay ? "auto" : "metadata"}
                aria-label={label}
                title={label}
                tabIndex={0}
                onClick={openLightbox}
                onKeyDown={(e) => e.key === "Enter" && openLightbox()}
            />
            {!hints.sticker && !shouldPlay && <span className="mx_BeeperAnimatedVideo_badge">GIF</span>}
            {hints.bridgedSticker?.pack_url && (
                <a
                    className="mx_BeeperAnimatedVideo_pack"
                    href={hints.bridgedSticker.pack_url}
                    target="_blank"
                    rel="noreferrer noopener"
                >
                    {_t("beeper|animated_open_sticker_pack")}
                </a>
            )}
        </div>
    );
}
