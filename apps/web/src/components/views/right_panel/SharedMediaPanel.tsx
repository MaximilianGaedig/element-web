/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import classNames from "classnames";
import { type AudioInfo, type FileContent, type MediaEventContent } from "matrix-js-sdk/src/types";
import {
    MatrixEventEvent,
    type MatrixClient,
    type MatrixEvent,
    MsgType,
    type Room,
    RoomEvent,
} from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";
import OverflowVerticalIcon from "@vector-im/compound-design-tokens/assets/web/icons/overflow-vertical";
import CheckIcon from "@vector-im/compound-design-tokens/assets/web/icons/check";
import ChatIcon from "@vector-im/compound-design-tokens/assets/web/icons/chat";
import CloseIcon from "@vector-im/compound-design-tokens/assets/web/icons/close";
import DeleteIcon from "@vector-im/compound-design-tokens/assets/web/icons/delete";
import DownloadIcon from "@vector-im/compound-design-tokens/assets/web/icons/download";
import ForwardIcon from "@vector-im/compound-design-tokens/assets/web/icons/forward";
import PlayIcon from "@vector-im/compound-design-tokens/assets/web/icons/play-solid";

import { _t } from "../../../languageHandler";
import BaseCard from "./BaseCard";
import AccessibleButton from "../elements/AccessibleButton";
import IconizedContextMenu, {
    IconizedContextMenuCheckbox,
    IconizedContextMenuOption,
    IconizedContextMenuOptionList,
} from "../context_menus/IconizedContextMenu";
import { useContextMenu } from "../../structures/ContextMenu";
import UIStore from "../../../stores/UIStore";
import { scrollStripTo } from "../telegram/TgStickersPanel";
import Spinner from "../elements/Spinner";
import Modal from "../../../Modal";
import AlbumLightbox from "../elements/AlbumLightbox";
import { isTelegramLayout } from "../../../utils/telegram/telegramLayout";
import MessageEvent from "../messages/MessageEvent";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";
import { type ViewRoomPayload } from "../../../dispatcher/payloads/ViewRoomPayload";
import { mediaFromContent } from "../../../customisations/Media";
import { MediaEventHelper } from "../../../utils/MediaEventHelper";
import { FileDownloader } from "../../../utils/FileDownloader";
import { formatFullDateNoDayNoTime } from "../../../DateUtils";
import { ScopedRoomContextProvider } from "../../../contexts/ScopedRoomContext";
import RoomContext, { TimelineRenderingType } from "../../../contexts/RoomContext";
import { useMatrixClientContext } from "../../../contexts/MatrixClientContext";
import { fetchRoomStats } from "../../../utils/chatHistory";
import {
    mediaSenderName,
    SHARED_MEDIA_TABS,
    SharedMediaLoader,
    type SharedMediaState,
    type SharedMediaTab,
} from "../../../utils/sharedMedia";

const TAB_LABELS: Record<SharedMediaTab, () => string> = {
    media: () => _t("bridge|shared_media|media"),
    files: () => _t("bridge|shared_media|files"),
    links: () => _t("bridge|shared_media|links"),
    music: () => _t("bridge|shared_media|music"),
    voice: () => _t("bridge|shared_media|voice"),
};

const EMPTY_LABELS: Record<SharedMediaTab, () => string> = {
    media: () => _t("bridge|shared_media|empty_media"),
    files: () => _t("bridge|shared_media|empty_files"),
    links: () => _t("bridge|shared_media|empty_links"),
    music: () => _t("bridge|shared_media|empty_music"),
    voice: () => _t("bridge|shared_media|empty_voice"),
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
    return event.getContent().msgtype === MsgType.Video ? filter.videos : filter.photos;
}

/** tweb sharedMedia.tsx: the tab's "⋮" menu, with the Photos / Videos checkboxes on the media tab. */
function TabMenu({
    tab,
    filter,
    onChange,
    onSelect,
}: {
    tab: SharedMediaTab;
    filter: MediaFilter;
    onChange: (f: MediaFilter) => void;
    onSelect: () => void;
}): JSX.Element {
    const [menuOpen, button, openMenu, closeMenu] = useContextMenu<HTMLDivElement>();
    const rect = button.current?.getBoundingClientRect();
    return (
        <>
            <AccessibleButton
                ref={button}
                className="mx_SharedMedia_filterButton"
                onClick={openMenu}
                aria-label={_t("bridge|shared_media|filter")}
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
                        <IconizedContextMenuOption
                            label={_t("bridge|shared_media|select")}
                            onClick={() => {
                                closeMenu();
                                onSelect();
                            }}
                        />
                        {tab === "media" && (
                            <>
                                <IconizedContextMenuCheckbox
                                    label={_t("bridge|shared_media|photos")}
                                    active={filter.photos}
                                    onClick={() => onChange(toggleMediaFilter(filter, "photos"))}
                                />
                                <IconizedContextMenuCheckbox
                                    label={_t("bridge|shared_media|videos")}
                                    active={filter.videos}
                                    onClick={() => onChange(toggleMediaFilter(filter, "videos"))}
                                />
                            </>
                        )}
                    </IconizedContextMenuOptionList>
                </IconizedContextMenu>
            )}
        </>
    );
}

/**
 * tweb updateMediaSubtitle: "45 photos, 6 videos", and the same for the other tabs. The counts are the
 * homeserver's, so they describe the whole room and not the part of it that happens to be loaded; without
 * them (or for links, which the server counts as text) only a list that has run out knows how many.
 */
function tabSubtitle(
    tab: SharedMediaTab,
    state: SharedMediaState,
    filter: MediaFilter,
    byKind?: Record<string, number>,
): string {
    const loadedVideos = state.items.filter((e) => e.getContent().msgtype === MsgType.Video).length;
    if (tab === "media") {
        const photos = byKind ? (byKind.image ?? 0) : state.items.length - loadedVideos;
        const videos = byKind ? (byKind.video ?? 0) : loadedVideos;
        const parts: string[] = [];
        if (filter.photos && photos) parts.push(_t("bridge|shared_media|photo_count", { count: photos }));
        if (filter.videos && videos) parts.push(_t("bridge|shared_media|video_count", { count: videos }));
        return parts.join(", ");
    }
    const kind = { files: "file", music: "audio", voice: "voice", links: undefined }[tab];
    const count = kind && byKind ? (byKind[kind] ?? 0) : state.done ? state.items.length : 0;
    if (!count) return "";
    switch (tab) {
        case "files":
            return _t("bridge|shared_media|file_count", { count });
        case "music":
            return _t("bridge|shared_media|track_count", { count });
        case "voice":
            return _t("bridge|shared_media|voice_count", { count });
        default:
            return _t("bridge|shared_media|link_count", { count });
    }
}

/** The room's message counts by kind, when the homeserver keeps them (`im.mxg.room_stats`). */
function useRoomKindCounts(room: Room): Record<string, number> | undefined {
    const [byKind, setByKind] = useState<Record<string, number> | undefined>();
    useEffect(() => {
        let cancelled = false;
        void fetchRoomStats(room.client, room.roomId).then((stats) => {
            // Counting runs in the background on the server; a partial count would understate the room.
            if (!cancelled && stats?.complete) setByKind(stats.by_kind);
        });
        return () => {
            cancelled = true;
        };
    }, [room]);
    return byKind;
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

function formatDuration(ms: unknown): string | undefined {
    if (typeof ms !== "number" || !(ms > 0)) return undefined;
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function useLoader(room: Room): SharedMediaLoader {
    const client = useMatrixClientContext();
    const loader = useMemo(() => new SharedMediaLoader(client, room), [client, room]);
    useEffect(() => {
        loader.attach();
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

/** Telegram's selection mode: what is ticked, and whether the list is in it at all. */
interface Selection {
    ids: Set<string>;
    active: boolean;
    start: () => void;
    toggle: (event: MatrixEvent) => void;
    clear: () => void;
}

function useSelection(): Selection {
    const [ids, setIds] = useState<Set<string>>(new Set());
    const [active, setActive] = useState(false);
    return useMemo(
        () => ({
            ids,
            active: active || ids.size > 0,
            start: () => setActive(true),
            toggle: (event: MatrixEvent) => {
                const id = event.getId();
                if (!id) return;
                setActive(true);
                setIds((prev) => {
                    const next = new Set(prev);
                    if (!next.delete(id)) next.add(id);
                    return next;
                });
            },
            clear: () => {
                setActive(false);
                setIds(new Set());
            },
        }),
        [ids, active],
    );
}

/** Downloads what the selection holds, one file after another (a browser refuses a burst of them). */
async function downloadAll(events: MatrixEvent[]): Promise<void> {
    const downloader = new FileDownloader();
    for (const event of events) {
        const helper = new MediaEventHelper(event);
        try {
            await downloader.download({ blob: await helper.sourceBlob.value, name: helper.fileName });
        } catch (e) {
            logger.warn("Shared media: could not download", event.getId(), e);
        } finally {
            helper.destroy();
        }
    }
}

/** Element's own forward dialog takes several events at once. Loaded on demand: it pulls in the timeline. */
async function forwardAll(client: MatrixClient, events: MatrixEvent[]): Promise<void> {
    const { default: ForwardDialog } = await import("../dialogs/ForwardDialog");
    Modal.createDialog(ForwardDialog, { matrixClient: client, events, permalinkCreator: null });
}

/** Telegram's selection bar: how many are ticked, and what can be done with them. */
function SelectionBar({
    room,
    events,
    selection,
}: {
    room: Room;
    events: MatrixEvent[];
    selection: Selection;
}): JSX.Element {
    const client = useMatrixClientContext();
    const userId = client.getSafeUserId();
    const hasMedia = events.some((ev) => MediaEventHelper.isEligible(ev));
    const mayRedact = events.every((ev) => room.currentState.maySendRedactionForEvent(ev, userId));
    const remove = async (): Promise<void> => {
        const [{ default: QuestionDialog }] = await Promise.all([import("../dialogs/QuestionDialog")]);
        const { finished } = Modal.createDialog(QuestionDialog, {
            title: _t("bridge|shared_media|delete_title", { count: events.length }),
            description: _t("bridge|shared_media|delete_description", { count: events.length }),
            button: _t("action|remove"),
            danger: true,
        });
        const [proceed] = await finished;
        if (!proceed) return;
        selection.clear();
        for (const event of events) {
            const id = event.getId();
            if (!id) continue;
            try {
                await client.redactEvent(room.roomId, id);
            } catch (e) {
                logger.warn("Shared media: could not remove", id, e);
            }
        }
    };
    return (
        <div className="mx_SharedMedia_selectionBar" role="toolbar">
            <AccessibleButton
                className="mx_SharedMedia_selectionAction"
                onClick={selection.clear}
                aria-label={_t("action|cancel")}
            >
                <CloseIcon />
            </AccessibleButton>
            <span className="mx_SharedMedia_selectionCount">
                {_t("bridge|shared_media|selected_count", { count: events.length })}
            </span>
            {events.length === 1 && (
                <AccessibleButton
                    className="mx_SharedMedia_selectionAction"
                    onClick={() => jumpTo(events[0])}
                    title={_t("bridge|shared_media|show_in_chat")}
                >
                    <ChatIcon />
                </AccessibleButton>
            )}
            <AccessibleButton
                className="mx_SharedMedia_selectionAction"
                disabled={!events.length}
                onClick={() => void forwardAll(client, events)}
                title={_t("action|forward")}
            >
                <ForwardIcon />
            </AccessibleButton>
            {hasMedia && (
                <AccessibleButton
                    className="mx_SharedMedia_selectionAction"
                    onClick={() => void downloadAll(events.filter((ev) => MediaEventHelper.isEligible(ev)))}
                    title={_t("action|download")}
                >
                    <DownloadIcon />
                </AccessibleButton>
            )}
            {mayRedact && (
                <AccessibleButton
                    className="mx_SharedMedia_selectionAction mx_SharedMedia_selectionAction_danger"
                    onClick={() => void remove()}
                    title={_t("action|remove")}
                >
                    <DeleteIcon />
                </AccessibleButton>
            )}
        </div>
    );
}

/** The tick Telegram shows on a selected item; a plain mark, because the whole item is the button. */
function SelectionTick({ selected }: { selected: boolean }): JSX.Element {
    return (
        <span
            className={classNames("mx_SharedMedia_tick", { mx_SharedMedia_tick_on: selected })}
            aria-hidden
            data-testid="shared-media-tick"
        >
            {selected && <CheckIcon />}
        </span>
    );
}

function GridThumb({
    event,
    selection,
    onOpen,
}: {
    event: MatrixEvent;
    selection: Selection;
    onOpen: () => void;
}): JSX.Element {
    const content = event.getContent<MediaEventContent>();
    const encrypted = !!content.file;
    const [src, setSrc] = useState<string | null>(() => {
        if (encrypted) return null;
        const media = mediaFromContent(content);
        return media.hasThumbnail
            ? media.getThumbnailHttp(THUMB_SIZE, THUMB_SIZE, "crop")
            : content.msgtype === MsgType.Image
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
    const isVideo = content.msgtype === MsgType.Video;
    const time = isVideo ? formatDuration(content.info?.duration) : undefined;
    const selected = selection.ids.has(event.getId() ?? "");
    return (
        <button
            ref={ref}
            type="button"
            className={classNames("mx_SharedMedia_gridItem", { mx_SharedMedia_item_selected: selected })}
            data-tg-media-id={event.getId()}
            aria-pressed={selection.active ? selected : undefined}
            // Ctrl/⌘-click starts a selection without going through the menu, as elsewhere in Element.
            onClick={(e) => (selection.active || e.ctrlKey || e.metaKey ? selection.toggle(event) : onOpen())}
            aria-label={typeof content.body === "string" ? content.body : undefined}
        >
            {src ? <img src={src} alt="" loading="lazy" decoding="async" draggable={false} /> : null}
            {isVideo && <span className="mx_SharedMedia_videoTime">{time ?? "▶"}</span>}
            {selection.active && <SelectionTick selected={selected} />}
        </button>
    );
}

function MediaGrid({ items, selection }: { items: MatrixEvent[]; selection: Selection }): JSX.Element {
    const open = useCallback(
        (index: number) => {
            if (isTelegramLayout()) {
                // Shared media lists newest first; the viewer wants oldest first.
                const ordered = [...items].reverse();
                const event = items[index];
                const source = document.querySelector<HTMLElement>(
                    `.mx_SharedMedia_grid [data-tg-media-id="${CSS.escape(event.getId() ?? "")}"] img`,
                );
                // Loaded on demand: a static import puts the viewer into the startup module cycle.
                void import("../telegram/TgMediaViewer").then(({ openTgMediaViewer }) =>
                    openTgMediaViewer(ordered, ordered.indexOf(event), source),
                );
                return;
            }
            Modal.createDialog(AlbumLightbox, { items, startIndex: index }, "mx_Dialog_lightbox", undefined, true);
        },
        [items],
    );
    return (
        <div className="mx_SharedMedia_grid">
            {items.map((ev, i) => (
                <GridThumb key={ev.getId()} event={ev} selection={selection} onOpen={() => open(i)} />
            ))}
        </div>
    );
}

/** Who sent it and when, the line every row ends with; it jumps to the message in the chat. */
function RowMeta({ event, room }: { event: MatrixEvent; room: Room }): JSX.Element {
    return (
        <button type="button" className="mx_SharedMedia_rowMeta" onClick={() => jumpTo(event)}>
            <span>{mediaSenderName(event, room)}</span>
            <span className="mx_SharedMedia_sentTime">{formatFullDateNoDayNoTime(new Date(event.getTs()))}</span>
        </button>
    );
}

/**
 * A row while the list is in selection mode: an overlay takes the clicks, so the row keeps its own
 * buttons (they are not reachable while selecting, which is what Telegram does too).
 */
function Selectable({
    event,
    selection,
    children,
}: {
    event: MatrixEvent;
    selection: Selection;
    children: React.ReactNode;
}): JSX.Element {
    const selected = selection.ids.has(event.getId() ?? "");
    if (!selection.active) return <>{children}</>;
    return (
        <div className={classNames("mx_SharedMedia_selectableRow", { mx_SharedMedia_item_selected: selected })}>
            <SelectionTick selected={selected} />
            <div className="mx_SharedMedia_selectableRow_body">{children}</div>
            <button
                type="button"
                className="mx_SharedMedia_rowOverlay"
                aria-pressed={selected}
                aria-label={_t("bridge|shared_media|select")}
                onClick={() => selection.toggle(event)}
            />
        </div>
    );
}

/**
 * A link: the message as the timeline renders it, so its mentions are the people's names and its URL
 * preview is the same card Telegram shows, with who sent it underneath.
 */
function LinkRow({ event, room }: { event: MatrixEvent; room: Room }): JSX.Element {
    return (
        <div className="mx_SharedMedia_link">
            <div className="mx_SharedMedia_linkText">
                <MessageEvent mxEvent={event} permalinkCreator={undefined} showUrlPreview={true} />
            </div>
            <RowMeta event={event} room={room} />
        </div>
    );
}

/** An audio message as the tabs read it: how long it plays, wherever the sender put that. */
type AudioEventContent = FileContent & { info?: AudioInfo; "org.matrix.msc1767.audio"?: { duration?: number } };

/**
 * Music and voice messages: a row that turns into Element's player when it is played. Building the
 * player downloads the whole file and decodes it for the waveform, so a tab full of them mounted at
 * once froze the client — the tab now costs nothing until something is played.
 */
function AudioRow({ event, room }: { event: MatrixEvent; room: Room }): JSX.Element {
    const [playing, setPlaying] = useState(false);
    const content = event.getContent<AudioEventContent>();
    if (playing) return <BodyRow event={event} room={room} />;
    const duration = formatDuration(content.info?.duration ?? content["org.matrix.msc1767.audio"]?.duration);
    return (
        <div className="mx_SharedMedia_row">
            <button type="button" className="mx_SharedMedia_audio" onClick={() => setPlaying(true)}>
                <span className="mx_SharedMedia_audioPlay" aria-hidden>
                    <PlayIcon />
                </span>
                <span className="mx_SharedMedia_audioText">
                    <span className="mx_SharedMedia_audioTitle">{content.filename ?? content.body}</span>
                    {duration && <span className="mx_SharedMedia_audioDuration">{duration}</span>}
                </span>
            </button>
            <RowMeta event={event} room={room} />
        </div>
    );
}

/** Documents reuse Element's own body (the download card), and audio does once it is played. */
function BodyRow({ event, room }: { event: MatrixEvent; room: Room }): JSX.Element {
    return (
        <div className="mx_SharedMedia_row">
            <MessageEvent mxEvent={event} permalinkCreator={undefined} />
            <RowMeta event={event} room={room} />
        </div>
    );
}

function TabContent({
    loader,
    tab,
    filter,
    selection,
}: {
    loader: SharedMediaLoader;
    tab: SharedMediaTab;
    filter: MediaFilter;
    selection: Selection;
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

    const room = loader.room;
    let list: JSX.Element | null = null;
    if (items.length) {
        if (tab === "media") {
            list = <MediaGrid items={items} selection={selection} />;
        } else {
            list = (
                <>
                    {items.map((ev) => (
                        <Selectable key={ev.getId()} event={ev} selection={selection}>
                            {tab === "links" ? (
                                <LinkRow event={ev} room={room} />
                            ) : tab === "files" ? (
                                <BodyRow event={ev} room={room} />
                            ) : (
                                <AudioRow event={ev} room={room} />
                            )}
                        </Selectable>
                    ))}
                </>
            );
        }
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
 * One shared-media tab: its count, its "⋮" menu, the selection bar while something is ticked, and the
 * list itself. The Telegram profile and Element's own card share it; `loader` is shared between the tabs
 * so switching doesn't reload.
 */
function SharedMediaTabBody({
    loader,
    tab,
    filter,
    setFilter,
    withHeader,
}: {
    loader: SharedMediaLoader;
    tab: SharedMediaTab;
    filter: MediaFilter;
    setFilter: (f: MediaFilter) => void;
    withHeader: boolean;
}): JSX.Element {
    const state = useTabState(loader, tab);
    const byKind = useRoomKindCounts(loader.room);
    const selection = useSelection();
    const selected = useMemo(
        () => state.items.filter((ev) => selection.ids.has(ev.getId() ?? "")),
        [state.items, selection.ids],
    );
    const subtitle = tabSubtitle(tab, state, filter, byKind);
    return (
        <>
            {selection.ids.size > 0 ? (
                <SelectionBar room={loader.room} events={selected} selection={selection} />
            ) : (
                withHeader && (
                    <div className="mx_SharedMedia_paneHeader">
                        <div className="mx_SharedMedia_subtitle">{subtitle}</div>
                        <TabMenu tab={tab} filter={filter} onChange={setFilter} onSelect={selection.start} />
                    </div>
                )
            )}
            <TabContent loader={loader} tab={tab} filter={filter} selection={selection} />
        </>
    );
}

/** tweb .menu-horizontal-div: pill tabs whose highlight slides to the active one (--tabs-transition). */
function Tabs({ active, onChange }: { active: SharedMediaTab; onChange: (tab: SharedMediaTab) => void }): JSX.Element {
    const refs = useRef(new Map<SharedMediaTab, HTMLButtonElement>());
    const [bg, setBg] = useState<{ left: number; width: number } | null>(null);
    useLayoutEffect(() => {
        const el = refs.current.get(active);
        if (!el) return;
        setBg({ left: el.offsetLeft, width: el.offsetWidth });
        // tweb .menu-horizontal-scrollable: the strip scrolls sideways and keeps the active tab in view
        // (scrolling only the strip; scrollIntoView would scroll the page too).
        const strip = el.parentElement;
        if (strip) scrollStripTo(strip, el, "center");
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

/**
 * Telegram Web K's shared media (sidebarRight/tabs/sharedMedia.tsx + appSearchSuper.ts): Media, Files,
 * Links, Music and Voice tabs. Replaces Element's Files timeline.
 */
export { useLoader as useSharedMediaLoader };

/**
 * One shared-media tab's list without tabs or a card around it. The Telegram profile puts these straight
 * into its own tab strip, like tweb's profile search-super.
 */
export function SharedMediaPane({ loader, tab }: { loader: SharedMediaLoader; tab: SharedMediaTab }): JSX.Element {
    const [filter, setFilter] = useState<MediaFilter>({ photos: true, videos: true });
    const roomContext = useContext(RoomContext);
    return (
        <ScopedRoomContextProvider {...roomContext} timelineRenderingType={TimelineRenderingType.File}>
            <div className="mx_SharedMedia mx_SharedMedia_pane">
                <SharedMediaTabBody
                    key={tab}
                    loader={loader}
                    tab={tab}
                    filter={filter}
                    setFilter={setFilter}
                    withHeader
                />
            </div>
        </ScopedRoomContextProvider>
    );
}

/** The labels of the shared-media tabs, in tweb's order. */
export const SHARED_MEDIA_TAB_LABELS: Array<{ id: SharedMediaTab; label: () => string }> = SHARED_MEDIA_TABS.map(
    (id) => ({ id, label: TAB_LABELS[id] }),
);

export default function SharedMediaPanel({ room, onClose }: Props): JSX.Element {
    const loader = useLoader(room);
    const [tab, setTab] = useState<SharedMediaTab>("media");
    const [filter, setFilter] = useState<MediaFilter>({ photos: true, videos: true });
    const roomContext = useContext(RoomContext);
    return (
        <ScopedRoomContextProvider {...roomContext} timelineRenderingType={TimelineRenderingType.File}>
            <BaseCard className="mx_SharedMedia" onClose={onClose} header={_t("bridge|shared_media|title")}>
                <div className="mx_SharedMedia_tabsRow">
                    <Tabs active={tab} onChange={setTab} />
                </div>
                <SharedMediaTabBody
                    key={tab}
                    loader={loader}
                    tab={tab}
                    filter={filter}
                    setFilter={setFilter}
                    withHeader
                />
            </BaseCard>
        </ScopedRoomContextProvider>
    );
}
