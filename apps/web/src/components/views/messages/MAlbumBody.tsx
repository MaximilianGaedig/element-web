/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useCallback, useEffect, useMemo, useReducer, useState } from "react";
import classNames from "classnames";
import { type MatrixEvent, MatrixEventEvent, MsgType } from "matrix-js-sdk/src/matrix";
import { PlaySolidIcon } from "@vector-im/compound-design-tokens/assets/web/icons";
import { HiddenMediaPlaceholder } from "@element-hq/web-shared-components";

import { type IBodyProps } from "./IBodyProps";
import { TextualBodyFactory } from "./TextualBodyFactory";
import { type MediaAlbumContextValue } from "../../../contexts/MediaAlbumContext";
import { MediaEventHelper } from "../../../utils/MediaEventHelper";
import {
    type AlbumSlot,
    buildAlbumSlots,
    getAlbumLayout,
    getCaptionEvents,
    getDeclaredCount,
    isVisualMedia,
    sortAlbumItems,
} from "../../../utils/MediaAlbum";
import { useMediaVisible } from "../../../hooks/useMediaVisible";
import { _t } from "../../../languageHandler";
import Modal from "../../../Modal";
import AlbumLightbox from "../elements/AlbumLightbox";
import MessageContextMenu from "../context_menus/MessageContextMenu";
import { aboveRightOf } from "../../structures/ContextMenu";

/** Props accepted by the component rendering non-visual album items (MessageEvent, passed in to avoid a cycle). */
export type AlbumItemBodyProps = Omit<IBodyProps, "onMessageAllowed" | "mediaEventHelper" | "ref">;

interface Props {
    album: MediaAlbumContextValue;
    /** body props of the anchor event */
    bodyProps: IBodyProps;
    /** renders a single non-visual (file/audio) album item */
    ItemBody: React.ComponentType<AlbumItemBodyProps>;
}

const THUMBNAIL_SIZE = 640;

/** Re-renders when any item is edited, decrypted or gets its remote echo. */
function useItemsVersion(items: MatrixEvent[]): number {
    const [version, bump] = useReducer((v: number) => v + 1, 0);
    useEffect(() => {
        const events = [MatrixEventEvent.Replaced, MatrixEventEvent.Decrypted, MatrixEventEvent.LocalEventIdReplaced];
        for (const item of items) for (const e of events) item.on(e, bump);
        return () => {
            for (const item of items) for (const e of events) item.off(e, bump);
        };
    }, [items]);
    return version;
}

function useThumbnail(helper: MediaEventHelper, isVideo: boolean): string | null {
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        let cancelled = false;
        const load = async (): Promise<string | null> => {
            const media = helper.media;
            if (!media.isEncrypted) {
                if (isVideo) return media.thumbnailHttp;
                return media.getThumbnailOfSourceHttp(THUMBNAIL_SIZE, THUMBNAIL_SIZE, "scale") ?? media.srcHttp;
            }
            const thumb = await helper.thumbnailUrl.value;
            if (thumb || isVideo) return thumb;
            return helper.sourceUrl.value;
        };
        load()
            .catch(() => null)
            .then((u) => {
                if (!cancelled) setUrl(u);
            });
        return () => {
            cancelled = true;
        };
    }, [helper, isVideo]);
    return url;
}

interface CellProps {
    event: MatrixEvent;
    position: number;
    total: number;
    /** number of further items hidden behind this (last visible) cell */
    overflow: number;
    onOpen: (event: MatrixEvent) => void;
    onItemContextMenu: (ev: React.MouseEvent, event: MatrixEvent) => void;
}

function AlbumCell({ event, position, total, overflow, onOpen, onItemContextMenu }: CellProps): JSX.Element {
    const content = event.getContent();
    const isVideo = content.msgtype === MsgType.Video;
    // The cell is keyed by the item's replacing event id, so an edit gets a fresh helper.
    const helper = useMemo(() => new MediaEventHelper(event), [event]);
    useEffect(() => () => helper.destroy(), [helper]);
    const thumbnail = useThumbnail(helper, isVideo);
    const [videoUrl, setVideoUrl] = useState<string | null>(null);

    const onClick = useCallback(
        (ev: React.MouseEvent): void => {
            if (ev.button !== 0 || ev.metaKey) return;
            ev.preventDefault();
            if (isVideo && overflow === 0) {
                // play in place, like the single-video tile does
                helper.sourceUrl.value.then(setVideoUrl).catch(() => onOpen(event));
                return;
            }
            onOpen(event);
        },
        [event, helper, isVideo, onOpen, overflow],
    );

    const name = content.body || _t("common|attachment");
    if (videoUrl) {
        return (
            <div
                className="mx_MAlbumBody_cell mx_MAlbumBody_cell_playing"
                onContextMenu={(ev) => onItemContextMenu(ev, event)}
            >
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video src={videoUrl} controls autoPlay title={name} poster={thumbnail ?? undefined} />
            </div>
        );
    }

    return (
        <button
            type="button"
            className={classNames("mx_MAlbumBody_cell", { mx_MAlbumBody_cell_video: isVideo })}
            data-testid="album-cell"
            aria-label={_t("timeline|media_album|item_label", {
                index: position + 1,
                count: total,
                name: isVideo ? _t("common|video") : _t("common|image"),
            })}
            title={name}
            onClick={onClick}
            onContextMenu={(ev) => onItemContextMenu(ev, event)}
        >
            {thumbnail ? <img src={thumbnail} alt="" draggable={false} /> : null}
            {isVideo && (
                <span className="mx_MAlbumBody_play" aria-hidden>
                    <PlaySolidIcon />
                </span>
            )}
            {overflow > 0 && (
                <span className="mx_MAlbumBody_overflow" data-testid="album-overflow">
                    {_t("timeline|media_album|overflow", { count: overflow })}
                </span>
            )}
        </button>
    );
}

interface MenuState {
    event: MatrixEvent;
    left: number;
    top: number;
}

/**
 * Renders a media album (several image/video events grouped by the MediaAlbumGrouper) as a Telegram-like grid,
 * followed by any non-visual items (files/audio) and the caption(s).
 */
export default function MAlbumBody({ album, bodyProps, ItemBody }: Props): JSX.Element {
    // re-render on edits/decryption of any item (these can change captions and media)
    useItemsVersion(album.items);
    const [mediaVisible, setMediaVisible] = useMediaVisible(album.anchor);
    const [menu, setMenu] = useState<MenuState | null>(null);
    const { permalinkCreator, getRelationsForEvent } = bodyProps;

    const sorted = sortAlbumItems(album.items);
    const visual = sorted.filter(isVisualMedia);
    const others = sorted.filter((e) => !isVisualMedia(e));
    const captions = getCaptionEvents(sorted);
    const slots: AlbumSlot[] = visual.length
        ? buildAlbumSlots(visual, others.length ? undefined : getDeclaredCount(sorted), Date.now())
        : [];
    const layout = getAlbumLayout(slots.length);

    const openLightbox = useCallback(
        (event: MatrixEvent): void => {
            Modal.createDialog(
                AlbumLightbox,
                { items: visual, startIndex: visual.indexOf(event), permalinkCreator },
                "mx_Dialog_lightbox",
                undefined,
                true,
            );
        },
        [visual, permalinkCreator],
    );

    const onItemContextMenu = useCallback(
        (ev: React.MouseEvent, event: MatrixEvent): void => {
            if (bodyProps.editState) return;
            ev.preventDefault();
            ev.stopPropagation();
            setMenu({ event, left: ev.clientX, top: ev.clientY });
        },
        [bodyProps.editState],
    );

    let grid: JSX.Element | null = null;
    if (slots.length && !mediaVisible) {
        grid = (
            <div className={`mx_MAlbumBody_grid mx_MAlbumBody_grid_${layout.variant}`}>
                <HiddenMediaPlaceholder onClick={() => setMediaVisible(true)}>
                    {_t("timeline|media_album|show_media")}
                </HiddenMediaPlaceholder>
            </div>
        );
    } else if (slots.length) {
        const visibleSlots = slots.slice(0, layout.visible);
        grid = (
            <div
                className={`mx_MAlbumBody_grid mx_MAlbumBody_grid_${layout.variant}`}
                role="group"
                aria-label={_t("timeline|media_album|label", { count: slots.length })}
                data-testid="album-grid"
            >
                {visibleSlots.map((slot, i) => {
                    const overflow = i === visibleSlots.length - 1 ? layout.overflow : 0;
                    if ("placeholder" in slot) {
                        return (
                            <div
                                key={`placeholder-${i}`}
                                className="mx_MAlbumBody_cell mx_MAlbumBody_cell_placeholder"
                                data-testid="album-placeholder"
                                aria-label={_t("common|loading")}
                            >
                                {overflow > 0 && (
                                    <span className="mx_MAlbumBody_overflow" data-testid="album-overflow">
                                        {_t("timeline|media_album|overflow", { count: overflow })}
                                    </span>
                                )}
                            </div>
                        );
                    }
                    return (
                        <AlbumCell
                            key={`${slot.event.getTxnId() || slot.event.getId()}|${slot.event.replacingEventId() ?? ""}`}
                            event={slot.event}
                            position={i}
                            total={slots.length}
                            overflow={overflow}
                            onOpen={openLightbox}
                            onItemContextMenu={onItemContextMenu}
                        />
                    );
                })}
            </div>
        );
    }

    let contextMenu: JSX.Element | null = null;
    if (menu) {
        const id = menu.event.getId()!;
        contextMenu = (
            <MessageContextMenu
                {...aboveRightOf({ left: menu.left, top: menu.top, bottom: menu.top })}
                mxEvent={menu.event}
                permalinkCreator={permalinkCreator}
                onFinished={() => setMenu(null)}
                rightClick={true}
                reactions={getRelationsForEvent?.(id, "m.annotation", "m.reaction") ?? null}
                link={permalinkCreator?.forEvent(id)}
                getRelationsForEvent={getRelationsForEvent}
            />
        );
    }

    return (
        <div className="mx_MAlbumBody" data-testid="album-body">
            {grid}
            {others.map((ev) => (
                <div
                    key={ev.getTxnId() || ev.getId()}
                    className="mx_MAlbumBody_item"
                    onContextMenu={(e) => onItemContextMenu(e, ev)}
                >
                    <ItemBody
                        mxEvent={ev}
                        permalinkCreator={permalinkCreator}
                        forExport={bodyProps.forExport}
                        getRelationsForEvent={getRelationsForEvent}
                        replacingEventId={ev.replacingEventId()}
                    />
                </div>
            ))}
            {captions.map((ev) => (
                <div key={ev.getTxnId() || ev.getId()} className="mx_MAlbumBody_caption" data-testid="album-caption">
                    <TextualBodyFactory
                        {...bodyProps}
                        ref={undefined}
                        mxEvent={ev}
                        replacingEventId={ev.replacingEventId()}
                        mediaEventHelper={undefined}
                        editState={undefined}
                    />
                </div>
            ))}
            {contextMenu}
        </div>
    );
}
