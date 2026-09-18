/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useCallback, useEffect, useMemo, useState } from "react";
import { type MatrixEvent, MsgType } from "matrix-js-sdk/src/matrix";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import ImageView from "./ImageView";
import { MediaEventHelper } from "../../../utils/MediaEventHelper";
import { type RoomPermalinkCreator } from "../../../utils/permalinks/Permalinks";
import { _t } from "../../../languageHandler";
import AccessibleButton from "./AccessibleButton";

interface Props {
    /** the visual items of the album, in display order */
    items: MatrixEvent[];
    startIndex: number;
    permalinkCreator?: RoomPermalinkCreator;
    onFinished: () => void;
}

/**
 * Lightbox for a media album: Element's ImageView for images (a plain player for videos),
 * with previous/next navigation across the album's items (buttons and the arrow keys).
 */
export default function AlbumLightbox({ items, startIndex, permalinkCreator, onFinished }: Props): JSX.Element {
    const [index, setIndex] = useState(() => Math.min(Math.max(startIndex, 0), items.length - 1));
    const [src, setSrc] = useState<{ event: MatrixEvent; url: string | null } | null>(null);
    const helpers = useMemo(() => new Map<MatrixEvent, MediaEventHelper>(), []);
    useEffect(() => () => helpers.forEach((h) => h.destroy()), [helpers]);

    const event = items[index];
    const isVideo = event.getContent().msgtype === MsgType.Video;

    useEffect(() => {
        let cancelled = false;
        let helper = helpers.get(event);
        if (!helper) {
            helper = new MediaEventHelper(event);
            helpers.set(event, helper);
        }
        const h = helper;
        (async (): Promise<string | null> => {
            try {
                return (await h.sourceUrl.value) ?? (await h.thumbnailUrl.value);
            } catch {
                return h.thumbnailUrl.value.catch(() => null);
            }
        })().then((url) => {
            if (!cancelled) setSrc({ event, url });
        });
        return () => {
            cancelled = true;
        };
    }, [event, helpers]);

    const count = items.length;
    const prev = useCallback(() => setIndex((i) => (i - 1 + count) % count), [count]);
    const next = useCallback(() => setIndex((i) => (i + 1) % count), [count]);

    useEffect(() => {
        if (count < 2) return;
        const onKeyDown = (ev: KeyboardEvent): void => {
            if (ev.key === "ArrowLeft") prev();
            else if (ev.key === "ArrowRight") next();
            else return;
            ev.preventDefault();
            ev.stopPropagation();
        };
        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, [count, prev, next]);

    const url = src?.event === event ? src.url : null;
    const content = event.getContent();
    let viewer: JSX.Element | null = null;
    if (url && isVideo) {
        viewer = (
            <div className="mx_AlbumLightbox_video">
                <AccessibleButton className="mx_AlbumLightbox_close" title={_t("action|close")} onClick={onFinished}>
                    <CloseIcon />
                </AccessibleButton>
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video key={event.getId()} src={url} controls autoPlay />
            </div>
        );
    } else if (url) {
        viewer = (
            <ImageView
                key={event.getId()}
                src={url}
                name={content.body || _t("common|attachment")}
                mxEvent={event}
                permalinkCreator={permalinkCreator}
                width={content.info?.w}
                height={content.info?.h}
                fileSize={content.info?.size}
                onFinished={onFinished}
            />
        );
    }

    return (
        <div className="mx_AlbumLightbox" data-testid="album-lightbox">
            {viewer ?? <div className="mx_AlbumLightbox_loading">{_t("common|loading")}</div>}
            {count > 1 && (
                <>
                    <AccessibleButton
                        className="mx_AlbumLightbox_nav mx_AlbumLightbox_prev"
                        title={_t("timeline|media_album|previous")}
                        onClick={prev}
                    >
                        <ChevronLeftIcon />
                    </AccessibleButton>
                    <AccessibleButton
                        className="mx_AlbumLightbox_nav mx_AlbumLightbox_next"
                        title={_t("action|next")}
                        onClick={next}
                    >
                        <ChevronRightIcon />
                    </AccessibleButton>
                    <div className="mx_AlbumLightbox_position" aria-live="polite">
                        {_t("timeline|media_album|position", { index: index + 1, count })}
                    </div>
                </>
            )}
        </div>
    );
}
