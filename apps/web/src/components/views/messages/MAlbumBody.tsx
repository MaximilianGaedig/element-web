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
import { getAlbumGridLayout, getCaptionEvents, isVisualMedia, sortAlbumItems } from "../../../utils/MediaAlbum";
import { type AlbumGridLayout, type GroupedMediaGeometry } from "../../../utils/GroupedMediaLayout";
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
        void load()
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
    /** position of the cell as percentages of the album box */
    style: React.CSSProperties;
    onOpen: (event: MatrixEvent) => void;
    onItemContextMenu: (ev: React.MouseEvent, event: MatrixEvent) => void;
}

function AlbumCell({ event, position, total, style, onOpen, onItemContextMenu }: CellProps): JSX.Element {
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
            if (isVideo) {
                // play in place, like the single-video tile does
                helper.sourceUrl.value.then(setVideoUrl).catch(() => onOpen(event));
                return;
            }
            onOpen(event);
        },
        [event, helper, isVideo, onOpen],
    );

    const name = content.body || _t("common|attachment");
    if (videoUrl) {
        return (
            <div
                className="mx_MAlbumBody_cell mx_MAlbumBody_cell_playing"
                style={style}
                onContextMenu={(ev) => onItemContextMenu(ev, event)}
            >
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
            style={style}
            onClick={onClick}
            onContextMenu={(ev) => onItemContextMenu(ev, event)}
        >
            {thumbnail ? <img src={thumbnail} alt="" draggable={false} /> : null}
            {isVideo && (
                <span className="mx_MAlbumBody_play" aria-hidden>
                    <PlaySolidIcon />
                </span>
            )}
        </button>
    );
}

/** tweb's prepareAlbum: items are absolutely positioned in percent of the album box, so the album scales as one. */
function cellStyle(geometry: GroupedMediaGeometry, layout: AlbumGridLayout): React.CSSProperties {
    const pct = (v: number, of: number): string => `${(v / of) * 100}%`;
    return {
        left: pct(geometry.x, layout.width),
        top: pct(geometry.y, layout.height),
        width: pct(geometry.width, layout.width),
        height: pct(geometry.height, layout.height),
    };
}

interface MenuState {
    event: MatrixEvent;
    left: number;
    top: number;
}

/**
 * Renders a media album (several image/video events grouped by the MediaAlbumGrouper) with Telegram's grouped
 * media layout (see GroupedMediaLayout), followed by any non-visual items (files/audio) and the caption.
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
    const layout = visual.length ? getAlbumGridLayout(visual) : null;

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
    if (layout) {
        // The box has the album's own aspect ratio and is scaled down as a whole when the timeline is narrower,
        // so thumbnails loading never change its height.
        const boxStyle: React.CSSProperties = {
            width: `${layout.width}px`,
            aspectRatio: `${layout.width} / ${layout.height}`,
        };
        grid = (
            <div
                className="mx_MAlbumBody_grid"
                style={boxStyle}
                role="group"
                aria-label={_t("timeline|media_album|label", { count: visual.length })}
                data-testid="album-grid"
            >
                {mediaVisible ? (
                    visual.map((event, i) => (
                        <AlbumCell
                            key={`${event.getTxnId() || event.getId()}|${event.replacingEventId() ?? ""}`}
                            event={event}
                            position={i}
                            total={visual.length}
                            style={cellStyle(layout.items[i].geometry, layout)}
                            onOpen={openLightbox}
                            onItemContextMenu={onItemContextMenu}
                        />
                    ))
                ) : (
                    <HiddenMediaPlaceholder onClick={() => setMediaVisible(true)}>
                        {_t("timeline|media_album|show_media")}
                    </HiddenMediaPlaceholder>
                )}
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
