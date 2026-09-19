/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import classNames from "classnames";
import { type MediaEventContent } from "matrix-js-sdk/src/types";
import { MatrixEventEvent, type MatrixEvent, type Room, RoomEvent } from "matrix-js-sdk/src/matrix";

import { _t } from "../../../languageHandler";
import BaseCard from "../right_panel/BaseCard";
import AccessibleButton from "../elements/AccessibleButton";
import IconizedContextMenu, {
    IconizedContextMenuCheckbox,
    IconizedContextMenuOptionList,
} from "../context_menus/IconizedContextMenu";
import { useContextMenu } from "../../structures/ContextMenu";
import UIStore from "../../../stores/UIStore";
import OverflowVerticalIcon from "@vector-im/compound-design-tokens/assets/web/icons/overflow-vertical";
import Spinner from "../elements/Spinner";
import Modal from "../../../Modal";
import AlbumLightbox from "../elements/AlbumLightbox";
import MessageEvent from "../messages/MessageEvent";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { type ViewRoomPayload } from "../../../dispatcher/payloads/ViewRoomPayload";
import { mediaFromContent } from "../../../customisations/Media";
import { MediaEventHelper } from "../../../utils/MediaEventHelper";
import { formatFullDateNoDayNoTime } from "../../../DateUtils";
import { ScopedRoomContextProvider } from "../../../contexts/ScopedRoomContext";
import RoomContext, { TimelineRenderingType } from "../../../contexts/RoomContext";
import { useMatrixClientContext } from "../../../contexts/MatrixClientContext";
import {
    extractLinks,
    SHARED_MEDIA_TABS,
    SharedMediaLoader,
    type SharedMediaState,
    type SharedMediaTab,
} from "../../../utils/beeper/sharedMedia";

const TAB_LABELS: Record<SharedMediaTab, () => string> = {
    media: () => _t("beeper|shared_media|media"),
    files: () => _t("beeper|shared_media|files"),
    links: () => _t("beeper|shared_media|links"),
    music: () => _t("beeper|shared_media|music"),
    voice: () => _t("beeper|shared_media|voice"),
};

const EMPTY_LABELS: Record<SharedMediaTab, () => string> = {
    media: () => _t("beeper|shared_media|empty_media"),
    files: () => _t("beeper|shared_media|empty_files"),
    links: () => _t("beeper|shared_media|empty_links"),
    music: () => _t("beeper|shared_media|empty_music"),
    voice: () => _t("beeper|shared_media|empty_voice"),
};

/** tweb sharedMediaFilters.ts: photos and/or videos, never neither. */
interface MediaFilter {
    photos: boolean;
    videos: boolean;
}

function toggleMediaFilter(filter: MediaFilter, key: keyof MediaFilter): MediaFilter {
    const next = { ...filter, [key]: !filter[key] };
    return next.photos || next.videos ? next : filter;
}

function matchesMediaFilter(event: MatrixEvent, filter: MediaFilter): boolean {
    return event.getContent().msgtype === "m.video" ? filter.videos : filter.photos;
}

/** tweb sharedMedia.tsx: the tab's "⋮" menu with Photos / Videos checkboxes. */
function MediaFilterMenu({
    filter,
    onChange,
}: {
    filter: MediaFilter;
    onChange: (f: MediaFilter) => void;
}): JSX.Element {
    const [menuOpen, button, openMenu, closeMenu] = useContextMenu<HTMLDivElement>();
    const rect = button.current?.getBoundingClientRect();
    return (
        <>
            <AccessibleButton
                ref={button}
                className="mx_SharedMedia_filterButton"
                onClick={openMenu}
                aria-label={_t("beeper|shared_media|filter")}
                aria-expanded={menuOpen}
            >
                <OverflowVerticalIcon />
            </AccessibleButton>
            {menuOpen && rect && (
                <IconizedContextMenu
                    onFinished={closeMenu}
                    top={rect.bottom + 4}
                    right={UIStore.instance.windowWidth - rect.right}
                    compact
                >
                    <IconizedContextMenuOptionList>
                        <IconizedContextMenuCheckbox
                            label={_t("beeper|shared_media|photos")}
                            active={filter.photos}
                            onClick={() => onChange(toggleMediaFilter(filter, "photos"))}
                        />
                        <IconizedContextMenuCheckbox
                            label={_t("beeper|shared_media|videos")}
                            active={filter.videos}
                            onClick={() => onChange(toggleMediaFilter(filter, "videos"))}
                        />
                    </IconizedContextMenuOptionList>
                </IconizedContextMenu>
            )}
        </>
    );
}

/** tweb updateMediaSubtitle: "12 photos, 3 videos" for the enabled kinds that have any. */
function mediaSubtitle(items: MatrixEvent[], filter: MediaFilter): string {
    const videos = items.filter((e) => e.getContent().msgtype === "m.video").length;
    const photos = items.length - videos;
    const parts: string[] = [];
    if (filter.photos && photos) parts.push(_t("beeper|shared_media|photo_count", { count: photos }));
    if (filter.videos && videos) parts.push(_t("beeper|shared_media|video_count", { count: videos }));
    return parts.join(", ");
}

/** Grid thumbnails are requested at this size (3 columns of the right panel), cropped square server-side. */
const THUMB_SIZE = 160;

function jumpTo(event: MatrixEvent): void {
    dis.dispatch<ViewRoomPayload>({
        action: Action.ViewRoom,
        event_id: event.getId(),
        highlighted: true,
        room_id: event.getRoomId(),
        metricsTrigger: undefined,
    });
}

function formatVideoTime(ms: unknown): string | undefined {
    if (typeof ms !== "number" || !(ms > 0)) return undefined;
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function useLoader(room: Room): SharedMediaLoader {
    const client = useMatrixClientContext();
    const loader = useMemo(() => new SharedMediaLoader(client, room), [client, room]);
    useEffect(() => {
        const onTimeline = (ev: MatrixEvent, evRoom: Room | undefined, toStart?: boolean): void => {
            if (evRoom?.roomId !== room.roomId || toStart) return;
            loader.addLive(ev);
        };
        const onDecrypted = (ev: MatrixEvent): void => {
            if (ev.getRoomId() === room.roomId) loader.addLive(ev);
        };
        const onRedaction = (ev: MatrixEvent): void => {
            const redacts = ev.getAssociatedId();
            if (redacts) loader.remove(redacts);
        };
        client.on(RoomEvent.Timeline, onTimeline);
        client.on(MatrixEventEvent.Decrypted, onDecrypted);
        room.on(RoomEvent.Redaction, onRedaction);
        return () => {
            client.off(RoomEvent.Timeline, onTimeline);
            client.off(MatrixEventEvent.Decrypted, onDecrypted);
            room.off(RoomEvent.Redaction, onRedaction);
            loader.destroy();
        };
    }, [client, room, loader]);
    return loader;
}

function useTabState(loader: SharedMediaLoader, tab: SharedMediaTab): SharedMediaState {
    const [state, setState] = useState(() => loader.state(tab));
    useEffect(() => {
        setState(loader.state(tab));
        return loader.subscribe(() => setState(loader.state(tab)));
    }, [loader, tab]);
    return state;
}

/** tweb .menu-horizontal-div: pill tabs whose highlight slides to the active one (--tabs-transition). */
function Tabs({ active, onChange }: { active: SharedMediaTab; onChange: (tab: SharedMediaTab) => void }): JSX.Element {
    const refs = useRef(new Map<SharedMediaTab, HTMLButtonElement>());
    const [bg, setBg] = useState<{ left: number; width: number } | null>(null);
    useLayoutEffect(() => {
        const el = refs.current.get(active);
        if (!el) return;
        setBg({ left: el.offsetLeft, width: el.offsetWidth });
        // tweb .menu-horizontal-scrollable: the strip scrolls sideways and keeps the active tab in view.
        el.scrollIntoView?.({ inline: "center", block: "nearest", behavior: "smooth" });
    }, [active]);
    return (
        <div className="mx_SharedMedia_tabs" role="tablist">
            {bg && (
                <span
                    className="mx_SharedMedia_tabBackground"
                    style={{ transform: `translateX(${bg.left}px)`, width: bg.width }}
                />
            )}
            {SHARED_MEDIA_TABS.map((tab) => (
                <button
                    key={tab}
                    ref={(el) => void (el ? refs.current.set(tab, el) : refs.current.delete(tab))}
                    role="tab"
                    type="button"
                    aria-selected={tab === active}
                    className={classNames("mx_SharedMedia_tab", { mx_SharedMedia_tab_active: tab === active })}
                    onClick={() => onChange(tab)}
                >
                    {TAB_LABELS[tab]()}
                </button>
            ))}
        </div>
    );
}

function GridThumb({ event, onOpen }: { event: MatrixEvent; onOpen: () => void }): JSX.Element {
    const content = event.getContent<MediaEventContent>();
    const encrypted = !!content.file;
    const [src, setSrc] = useState<string | null>(() => {
        if (encrypted) return null;
        const media = mediaFromContent(content);
        return media.hasThumbnail
            ? media.getThumbnailHttp(THUMB_SIZE, THUMB_SIZE, "crop")
            : content.msgtype === "m.image"
              ? media.getThumbnailOfSourceHttp(THUMB_SIZE, THUMB_SIZE, "crop")
              : null;
    });
    const ref = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!encrypted || !ref.current) return;
        // Decrypt only what scrolls into view.
        let helper: MediaEventHelper | undefined;
        const observer = new IntersectionObserver((entries) => {
            if (!entries.some((e) => e.isIntersecting) || helper) return;
            helper = new MediaEventHelper(event);
            const url =
                content.info && "thumbnail_file" in content.info && content.info.thumbnail_file
                    ? helper.thumbnailUrl.value
                    : helper.sourceUrl.value;
            url.then(setSrc).catch(() => {});
            observer.disconnect();
        });
        observer.observe(ref.current);
        return () => {
            observer.disconnect();
            helper?.destroy();
        };
    }, [event, encrypted, content]);
    const isVideo = content.msgtype === "m.video";
    const time = isVideo ? formatVideoTime(content.info?.duration) : undefined;
    return (
        <button
            ref={ref}
            type="button"
            className="mx_SharedMedia_gridItem"
            onClick={onOpen}
            aria-label={typeof content.body === "string" ? content.body : undefined}
        >
            {src ? <img src={src} alt="" loading="lazy" decoding="async" draggable={false} /> : null}
            {isVideo && <span className="mx_SharedMedia_videoTime">{time ?? "▶"}</span>}
        </button>
    );
}

function MediaGrid({ items }: { items: MatrixEvent[] }): JSX.Element {
    const open = useCallback(
        (index: number) => {
            Modal.createDialog(AlbumLightbox, { items, startIndex: index }, "mx_Dialog_lightbox", undefined, true);
        },
        [items],
    );
    return (
        <div className="mx_SharedMedia_grid">
            {items.map((ev, i) => (
                <GridThumb key={ev.getId()} event={ev} onOpen={() => open(i)} />
            ))}
        </div>
    );
}

function LinkRow({ event }: { event: MatrixEvent }): JSX.Element {
    const links = extractLinks(event);
    const first = new URL(links[0]);
    const host = first.hostname.replace(/^www\./, "");
    const body = event.getContent().body;
    return (
        <div className="mx_SharedMedia_link">
            <span className="mx_SharedMedia_linkMedia" aria-hidden>
                {host.charAt(0)}
            </span>
            <div className="mx_SharedMedia_linkText">
                <div className="mx_SharedMedia_rowTitle">
                    <span>{host}</span>
                    <span className="mx_SharedMedia_sentTime">
                        {formatFullDateNoDayNoTime(new Date(event.getTs()))}
                    </span>
                </div>
                {typeof body === "string" && body !== links[0] && (
                    <div className="mx_SharedMedia_linkSubtitle">{body}</div>
                )}
                {links.map((href) => (
                    <a key={href} href={href} target="_blank" rel="noreferrer noopener">
                        {href}
                    </a>
                ))}
                <button type="button" className="mx_SharedMedia_sender" onClick={() => jumpTo(event)}>
                    {event.sender?.name ?? event.getSender()}
                </button>
            </div>
        </div>
    );
}

/** Documents, music and voice reuse Element's own bodies (download card, audio player with waveform). */
function BodyRow({ event }: { event: MatrixEvent }): JSX.Element {
    return (
        <div className="mx_SharedMedia_row">
            <MessageEvent mxEvent={event} permalinkCreator={undefined} />
            <button type="button" className="mx_SharedMedia_rowMeta" onClick={() => jumpTo(event)}>
                <span>{event.sender?.name ?? event.getSender()}</span>
                <span className="mx_SharedMedia_sentTime">{formatFullDateNoDayNoTime(new Date(event.getTs()))}</span>
            </button>
        </div>
    );
}

function TabContent({
    loader,
    tab,
    filter,
}: {
    loader: SharedMediaLoader;
    tab: SharedMediaTab;
    filter: MediaFilter;
}): JSX.Element {
    const state = useTabState(loader, tab);
    const { loading, done } = state;
    const items = useMemo(
        () => (tab === "media" ? state.items.filter((e) => matchesMediaFilter(e, filter)) : state.items),
        [state.items, tab, filter],
    );
    const sentinel = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = sentinel.current;
        if (!el || done) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((e) => e.isIntersecting)) void loader.loadMore(tab);
            },
            { rootMargin: "400px" },
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [loader, tab, done, items.length, loading]);

    let list: JSX.Element | null = null;
    if (items.length) {
        if (tab === "media") list = <MediaGrid items={items} />;
        else if (tab === "links")
            list = (
                <>
                    {items.map((ev) => (
                        <LinkRow key={ev.getId()} event={ev} />
                    ))}
                </>
            );
        else
            list = (
                <>
                    {items.map((ev) => (
                        <BodyRow key={ev.getId()} event={ev} />
                    ))}
                </>
            );
    }
    return (
        <div className={`mx_SharedMedia_content mx_SharedMedia_content_${tab}`} role="tabpanel">
            {list}
            {!items.length && done && <div className="mx_SharedMedia_empty">{EMPTY_LABELS[tab]()}</div>}
            {!done && (
                <div ref={sentinel} className="mx_SharedMedia_more">
                    {loading && <Spinner size={24} />}
                </div>
            )}
        </div>
    );
}

interface Props {
    room: Room;
    onClose: () => void;
}

/**
 * Telegram Web K's shared media (sidebarRight/tabs/sharedMedia.tsx + appSearchSuper.ts): Media, Files,
 * Links, Music and Voice tabs. Replaces Element's Files timeline.
 */
export default function SharedMediaPanel({ room, onClose }: Props): JSX.Element {
    const loader = useLoader(room);
    const [tab, setTab] = useState<SharedMediaTab>("media");
    const [filter, setFilter] = useState<MediaFilter>({ photos: true, videos: true });
    const mediaState = useTabState(loader, "media");
    const subtitle = tab === "media" ? mediaSubtitle(mediaState.items, filter) : "";
    const roomContext = useContext(RoomContext);
    return (
        <ScopedRoomContextProvider {...roomContext} timelineRenderingType={TimelineRenderingType.File}>
            <BaseCard className="mx_SharedMedia" onClose={onClose} header={_t("beeper|shared_media|title")}>
                <div className="mx_SharedMedia_tabsRow">
                    <Tabs active={tab} onChange={setTab} />
                    {tab === "media" && <MediaFilterMenu filter={filter} onChange={setFilter} />}
                </div>
                {subtitle && <div className="mx_SharedMedia_subtitle">{subtitle}</div>}
                <TabContent key={tab} loader={loader} tab={tab} filter={filter} />
            </BaseCard>
        </ScopedRoomContextProvider>
    );
}
