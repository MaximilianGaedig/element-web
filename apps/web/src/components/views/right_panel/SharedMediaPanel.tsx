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
import { useStuck } from "../../../hooks/useStuck";
import { scrollParentOf } from "../../../utils/scrollParent";
import { listOffsets, listWindow } from "../../../utils/listWindow";
import {
    mediaRows,
    placeholderTarget,
    sparseRows,
    type IndexPlaces,
    type MediaRow,
    type MediaSection,
    monthAt,
    type MonthSpan,
    rowAtTime,
    anchorAt,
    anchoredTop,
    type ScrollAnchor,
    floatingFloor,
    scrubberDragAt,
    scrubberLineTop,
    scrubberPillTop,
    scrubberTrackHeight,
    scrubberWorthIt,
    sectionAt,
    visibleRows,
} from "../../../utils/sharedMediaLayout";
import BaseCard from "./BaseCard";
import AccessibleButton from "../elements/AccessibleButton";
import IconizedContextMenu, {
    IconizedContextMenuCheckbox,
    IconizedContextMenuOption,
    IconizedContextMenuOptionList,
} from "../context_menus/IconizedContextMenu";
import { useContextMenu } from "../../structures/ContextMenu";
import UIStore, { UI_EVENTS } from "../../../stores/UIStore";
import { scrollStripTo } from "../telegram/TgStickersPanel";
import Modal from "../../../Modal";
import AlbumLightbox from "../elements/AlbumLightbox";
import { chatColumnsEnabled } from "../../../utils/telegram/telegramLayout";
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
    emptyTabsFromStats,
    mediaSenderName,
    SHARED_MEDIA_TABS,
    SharedMediaLoader,
    type SharedMediaState,
    type SharedMediaTab,
    tabCountsFromStats,
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
    const fromServer = byKind ? tabCountsFromStats(byKind)[tab] : undefined;
    const count = fromServer ?? (state.done ? state.items.length : 0);
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

/**
 * The tabs worth showing, in tweb's order: all of them, less the ones the server positively says are
 * empty (tweb appSearchSuper hideEmptyTabs). Unknown counts - no index, an encrypted room, the numbers
 * still loading - hide nothing. A tab that has something loaded (a message that just arrived) comes
 * back, as tweb's tab does when its counter leaves zero. Never empty: links are always there.
 */
export function useVisibleSharedMediaTabs(loader: SharedMediaLoader): SharedMediaTab[] {
    const { room } = loader;
    const byKind = useRoomKindCounts(room);
    const loaded = useLoadedTabs(loader);
    return useMemo(() => {
        // An encrypted room's index only sees ciphertext, so its zeros mean nothing.
        const empty = byKind && !room.client.isRoomEncrypted(room.roomId) ? emptyTabsFromStats(byKind) : undefined;
        return SHARED_MEDIA_TABS.filter((tab) => !empty?.has(tab) || loaded.includes(tab));
    }, [byKind, loaded, room]);
}

/** The tabs the loader already holds something for, as a list that only changes when that does. */
function useLoadedTabs(loader: SharedMediaLoader): SharedMediaTab[] {
    const read = useCallback(() => SHARED_MEDIA_TABS.filter((tab) => loader.state(tab).items.length > 0), [loader]);
    const [loaded, setLoaded] = useState(read);
    useEffect(() => {
        const update = (): void =>
            setLoaded((prev) => {
                const next = read();
                return next.join() === prev.join() ? prev : next;
            });
        update();
        return loader.subscribe(update);
    }, [loader, read]);
    return loaded;
}

/** Grid thumbnails are requested at least this size (3 columns of a narrow panel), cropped square server-side. */
const THUMB_SIZE = 160;

/**
 * The size to ask for, for a cell this wide. The panel is resizable, and a thumbnail fetched for a
 * narrow panel is a blur in a wide one - but it moves in steps, so dragging the edge does not fetch a
 * new picture for every pixel of it.
 */
export function thumbSizeFor(cell: number, pixelRatio: number): number {
    return Math.max(THUMB_SIZE, Math.ceil((cell * pixelRatio) / THUMB_SIZE) * THUMB_SIZE);
}

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
    /** Sets a whole run at once, as dragging across the grid does; `on` picks selecting or clearing. */
    setMany: (events: MatrixEvent[], on: boolean) => void;
    clear: () => void;
}

function useSelection(): Selection {
    const [ids, setIds] = useState<Set<string>>(new Set());
    const [active, setActive] = useState(false);
    // Escape leaves a selection wherever the focus happens to be, which is what every list does and
    // what someone reaches for before hunting down the close button.
    useEffect(() => {
        if (!active && !ids.size) return;
        const onKey = (e: KeyboardEvent): void => {
            if (e.key !== "Escape") return;
            e.stopPropagation();
            setActive(false);
            setIds(new Set());
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [active, ids.size]);
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
            setMany: (events: MatrixEvent[], on: boolean) => {
                const changing = events.map((e) => e.getId()).filter((id): id is string => !!id);
                if (!changing.length) return;
                setActive(true);
                setIds((prev) => {
                    const next = new Set(prev);
                    for (const id of changing) {
                        if (on) next.add(id);
                        else next.delete(id);
                    }
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

/** Asks, then removes what the selection holds, one message after another. */
async function removeAll(
    client: MatrixClient,
    room: Room,
    events: MatrixEvent[],
    onConfirmed: () => void,
): Promise<void> {
    const { default: QuestionDialog } = await import("../dialogs/QuestionDialog");
    const { finished } = Modal.createDialog(QuestionDialog, {
        title: _t("bridge|shared_media|delete_title", { count: events.length }),
        description: _t("bridge|shared_media|delete_description", { count: events.length }),
        button: _t("action|remove"),
        danger: true,
    });
    const [proceed] = await finished;
    if (!proceed) return;
    onConfirmed();
    for (const event of events) {
        const id = event.getId();
        if (!id) continue;
        try {
            await client.redactEvent(room.roomId, id);
        } catch (e) {
            logger.warn("Shared media: could not remove", id, e);
        }
    }
}

/**
 * What right-clicking an item offers: the same things the selection bar does for one message, in a
 * menu at the pointer. Built from Element's own menu components, like the tab's "⋮" menu.
 */
function ItemContextMenu({
    room,
    event,
    at,
    onFinished,
    onOpen,
    onSelect,
}: {
    room: Room;
    event: MatrixEvent;
    at: { x: number; y: number };
    onFinished: () => void;
    /** Only the grid has a viewer to open the picture in. */
    onOpen?: () => void;
    onSelect: () => void;
}): JSX.Element {
    const client = useMatrixClientContext();
    const mayRedact = room.currentState.maySendRedactionForEvent(event, client.getSafeUserId());
    const act = (action: () => void) => () => {
        onFinished();
        action();
    };
    return (
        <IconizedContextMenu onFinished={onFinished} left={at.x} top={at.y} compact>
            <IconizedContextMenuOptionList>
                {onOpen && <IconizedContextMenuOption label={_t("action|open")} onClick={act(onOpen)} />}
                <IconizedContextMenuOption
                    label={_t("bridge|shared_media|show_in_chat")}
                    onClick={act(() => jumpTo(event))}
                />
                {MediaEventHelper.isEligible(event) && (
                    <IconizedContextMenuOption
                        label={_t("action|download")}
                        onClick={act(() => void downloadAll([event]))}
                    />
                )}
                <IconizedContextMenuOption
                    label={_t("action|forward")}
                    onClick={act(() => void forwardAll(client, [event]))}
                />
                <IconizedContextMenuOption label={_t("bridge|shared_media|select")} onClick={act(onSelect)} />
                {mayRedact && (
                    <IconizedContextMenuOption
                        label={_t("action|remove")}
                        onClick={act(() => void removeAll(client, room, [event], () => {}))}
                    />
                )}
            </IconizedContextMenuOptionList>
        </IconizedContextMenu>
    );
}

/**
 * Right-click on an item. A touch that holds long enough to raise `contextmenu` (Android does) is not
 * a request for this menu: holding already starts a selection (useDragSelect), which carries the same
 * actions in its bar, and a menu opening over the selection it just began would be two answers to one press.
 */
function useItemMenu(): {
    menu: { x: number; y: number } | null;
    close: () => void;
    onContextMenu: (e: React.MouseEvent, touch: boolean) => void;
} {
    const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
    return {
        menu,
        close: useCallback(() => setMenu(null), []),
        onContextMenu: useCallback((e, touch) => {
            e.preventDefault();
            if (touch) return;
            setMenu({ x: e.clientX, y: e.clientY });
        }, []),
    };
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
    const remove = (): Promise<void> => removeAll(client, room, events, selection.clear);
    return (
        <div className="mx_SharedMedia_selectionBar" role="toolbar" data-mx-floating>
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
    index,
    size,
    drag,
    onRange,
    onContextMenu,
}: {
    event: MatrixEvent;
    selection: Selection;
    onOpen: () => void;
    index: number;
    /** What to ask the server for, which follows the width of the cell. */
    size: number;
    drag: DragSelect;
    onRange: (from: number, to: number) => void;
    onContextMenu: (e: React.MouseEvent, touch: boolean) => void;
}): JSX.Element {
    const content = event.getContent<MediaEventContent>();
    const touched = useRef(false);
    const encrypted = !!content.file;
    const plain = useMemo(() => {
        if (encrypted) return null;
        const media = mediaFromContent(content);
        return media.hasThumbnail
            ? media.getThumbnailHttp(size, size, "crop")
            : content.msgtype === MsgType.Image
              ? media.getThumbnailOfSourceHttp(size, size, "crop")
              : null;
    }, [content, encrypted, size]);
    const [decrypted, setDecrypted] = useState<string | null>(null);
    const src = plain ?? decrypted;
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
            url.then(setDecrypted).catch(() => {});
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
            data-grid-index={index}
            aria-pressed={selection.active ? selected : undefined}
            onPointerDown={(e) => {
                touched.current = e.pointerType === "touch";
                drag.onPointerDown(index, e);
            }}
            onContextMenu={(e) => onContextMenu(e, touched.current)}
            onPointerEnter={() => drag.onPointerEnter(index)}
            // Ctrl/⌘-click starts a selection without going through the menu, as elsewhere in Element.
            onClick={(e) => {
                // The press that just finished a drag, or started a selection by being held, must
                // not also count as a tap on the picture.
                if (drag.swallowedClick()) return;
                const from = drag.anchorAt();
                if (e.shiftKey && from !== undefined) {
                    // Reaching back to where the selection started, the way a file list does.
                    onRange(from, index);
                } else if (selection.active || e.ctrlKey || e.metaKey) {
                    drag.setAnchor(index);
                    selection.toggle(event);
                } else onOpen();
            }}
            aria-label={typeof content.body === "string" ? content.body : undefined}
        >
            {src ? <img src={src} alt="" loading="lazy" decoding="async" draggable={false} /> : null}
            {isVideo && <span className="mx_SharedMedia_videoTime">{time ?? "▶"}</span>}
            {selection.active && <SelectionTick selected={selected} />}
        </button>
    );
}

/** How long a press has to be held, with nothing selected yet, before it starts a selection. */
const LONG_PRESS_MS = 450;
/** How close to an edge a drag has to get before the column starts coming to meet it. */
const EDGE_SCROLL_ZONE = 64;
/** The most it moves per frame, at the very edge. */
const EDGE_SCROLL_SPEED = 18;

interface DragSelect {
    /** Where the last selection gesture started, which is what shift-click reaches back to. */
    anchorAt: () => number | undefined;
    setAnchor: (index: number) => void;
    onPointerDown: (index: number, e: React.PointerEvent<HTMLElement>) => void;
    onPointerEnter: (index: number) => void;
    /** True once a drag has done something, so the click that ends it must not open the picture. */
    swallowedClick: () => boolean;
}

/**
 * Selecting a run of items by dragging across them, as Telegram and Photos do.
 *
 * Two ways in, matching the platform: with a selection already going, a press starts dragging
 * immediately; with nothing selected, holding still for {@link LONG_PRESS_MS} starts one. Dragging
 * back over what was just covered puts it back the way it was, so overshooting is recoverable
 * rather than something to undo by hand afterwards.
 */
function useDragSelect(
    items: MatrixEvent[],
    selection: Selection,
    grid: React.RefObject<HTMLDivElement | null>,
): DragSelect {
    const drag = useRef<{ from: number; last: number; on: boolean; before: Set<string> } | null>(null);
    const anchor = useRef<number | undefined>(undefined);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const swallow = useRef(false);
    // Pointers whose capture onPointerDown let go of itself, so that is not mistaken for losing it.
    const released = useRef(new Set<number>());

    const idsOf = useCallback((from: number, to: number) => items.slice(from, to + 1), [items]);

    const reach = useCallback(
        (index: number) => {
            const d = drag.current;
            if (!d || index === d.last) return;
            const [lo, hi] = [Math.min(d.from, index), Math.max(d.from, index)];
            const [was, wasTo] = [Math.min(d.from, d.last), Math.max(d.from, d.last)];
            selection.setMany(idsOf(lo, hi), d.on);
            // Only once the drag has gone somewhere is it a drag, and so something shift-click can reach back to.
            anchor.current = d.from;
            // Anything the drag had reached and no longer covers goes back to how it started, so a
            // drag that went too far can simply be pulled back.
            const dropped = [...idsOf(was, lo - 1), ...idsOf(hi + 1, wasTo)];
            const restore = (on: boolean): void =>
                selection.setMany(
                    dropped.filter((e) => d.before.has(e.getId() ?? "") === on),
                    on,
                );
            if (dropped.length) {
                restore(true);
                restore(false);
            }
            d.last = index;
            swallow.current = true;
        },
        [idsOf, selection],
    );

    const begin = useCallback(
        (index: number, on: boolean) => {
            drag.current = { from: index, last: index, on, before: new Set(selection.ids) };
            anchor.current = index;
            selection.setMany(idsOf(index, index), on);
        },
        [idsOf, selection],
    );

    /*
     * Dragging past the edge of a virtualised grid.
     *
     * Only the rows on screen exist, so a drag can only reach the rest if the column comes to meet
     * it: near an edge this scrolls, faster the closer the pointer gets, and each frame asks what is
     * now under the pointer rather than waiting to be entered - a row that appears underneath a
     * finger that is already still never fires a pointerenter of its own.
     */
    // Read through a ref so the listeners below can be set up once: `reach` closes over the
    // selection, which changes with every item the drag takes.
    const reachRef = useRef(reach);
    reachRef.current = reach;

    useEffect(() => {
        let at: { x: number; y: number } | undefined;
        let frame: number | undefined;

        const step = (): void => {
            frame = undefined;
            if (!drag.current || !at) return;
            const box = scrollParentOf(grid.current);
            if (box) {
                const rect = box.getBoundingClientRect();
                const near = Math.min(EDGE_SCROLL_ZONE, rect.height / 3);
                const above = at.y - rect.top;
                const below = rect.bottom - at.y;
                if (above < near) box.scrollTop -= EDGE_SCROLL_SPEED * (1 - Math.max(0, above) / near);
                else if (below < near) box.scrollTop += EDGE_SCROLL_SPEED * (1 - Math.max(0, below) / near);
            }
            const under = document.elementFromPoint(at.x, at.y)?.closest<HTMLElement>("[data-grid-index]")
                ?.dataset.gridIndex;
            if (under !== undefined) reachRef.current(Number(under));
            frame = requestAnimationFrame(step);
        };

        const move = (e: PointerEvent): void => {
            if (!drag.current) return;
            at = { x: e.clientX, y: e.clientY };
            frame ??= requestAnimationFrame(step);
        };
        /*
         * Two ways for a press to stop. Letting go is the ordinary one, and the click that follows it
         * still has to be told it ended a drag. Everything else - the system cancelling the touch,
         * the pointer being taken from us, the window losing focus or being hidden mid-drag - leaves
         * no pointerup coming at all, so a drag only listening for that stayed "down": the next
         * pointer to cross the grid went on selecting, and a hold timer could start a selection
         * nobody was asking for. Those end it for good, and no click is coming to swallow.
         */
        const finish = (): void => {
            clearTimeout(timer.current);
            drag.current = null;
            at = undefined;
            if (frame !== undefined) cancelAnimationFrame(frame);
            frame = undefined;
        };
        const abort = (): void => {
            finish();
            swallow.current = false;
            released.current.clear();
        };
        const lostCapture = (e: PointerEvent): void => {
            // Letting go of the capture a touch starts with is how the drag begins (see onPointerDown).
            if (released.current.delete(e.pointerId)) return;
            abort();
        };
        const hidden = (): void => {
            if (document.hidden) abort();
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", finish);
        window.addEventListener("pointercancel", abort);
        window.addEventListener("lostpointercapture", lostCapture, true);
        window.addEventListener("blur", abort);
        document.addEventListener("visibilitychange", hidden);
        return () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", finish);
            window.removeEventListener("pointercancel", abort);
            window.removeEventListener("lostpointercapture", lostCapture, true);
            window.removeEventListener("blur", abort);
            document.removeEventListener("visibilitychange", hidden);
            clearTimeout(timer.current);
            if (frame !== undefined) cancelAnimationFrame(frame);
        };
    }, [grid]);

    return {
        anchorAt: () => anchor.current,
        setAnchor: (index) => void (anchor.current = index),
        onPointerDown: (index, e) => {
            // A touch captures the pointer to the element it started on, so without releasing it the
            // drag would never enter the neighbours and could only ever select the one item.
            if (e.currentTarget.hasPointerCapture?.(e.pointerId)) released.current.add(e.pointerId);
            e.currentTarget.releasePointerCapture?.(e.pointerId);
            swallow.current = false;
            if (selection.active) {
                /*
                 * Armed, not applied. The press itself changes nothing: if it turns into a drag the
                 * items it reaches are set (the first move covers the one it started on), and if it
                 * stays a tap the click that follows toggles it. Applying it here as well made the
                 * click toggle it a second time - a selected item deselected and came straight back.
                 */
                drag.current = {
                    from: index,
                    last: index,
                    on: !selection.ids.has(items[index]?.getId() ?? ""),
                    before: new Set(selection.ids),
                };
                return;
            }
            timer.current = setTimeout(() => {
                selection.start();
                begin(index, true);
                swallow.current = true;
            }, LONG_PRESS_MS);
        },
        onPointerEnter: (index) => {
            // Moving off the item before the hold finished means it was a drag, not a long press.
            clearTimeout(timer.current);
            reach(index);
        },
        swallowedClick: () => {
            const swallowed = swallow.current;
            swallow.current = false;
            return swallowed;
        },
    };
}

/** What a row of each list tab is roughly worth, until one has been measured. */
const ROW_ESTIMATE: Partial<Record<SharedMediaTab, number>> = { links: 96, files: 64, music: 64, voice: 64 };

/**
 * The list tabs, rendering only the rows on screen.
 *
 * Same reason as the grid - a chat's whole history of files or links is thousands of rows, and
 * building all of them costs seconds and then scrolls badly. The difference is that these rows are
 * not all the same height, so each is measured as it renders and the ones not yet seen stand at an
 * estimate (utils/listWindow.ts). The estimate being wrong only makes the total height approximate
 * until every row has been seen once.
 */
function VirtualRows({
    count,
    estimate,
    onNearEnd,
    children,
}: {
    count: number;
    estimate: number;
    onNearEnd: () => void;
    children: (index: number) => JSX.Element;
}): JSX.Element {
    const ref = useRef<HTMLDivElement>(null);
    const [measured, setMeasured] = useState<Map<number, number>>(new Map());
    // Which width the heights in `measured` were taken at; see the note where it changes.
    const [epoch, setEpoch] = useState(0);
    const [scroll, setScroll] = useState({ top: 0, viewport: 0 });

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const box = scrollParentOf(el);
        let width = el.clientWidth;
        const measure = (): void => {
            if (!box) return;
            /*
             * A row's height depends on how wide it is: a link's text wraps and a file's name
             * truncates differently. The heights measured at the old width are wrong for the new one,
             * and a row that is not on screen is never asked again, so they are dropped. The rows
             * that are on screen are remounted (the epoch is in their key), because a row only reports
             * when its size changes, and one that is still there at the new width has nothing to say.
             */
            if (el.clientWidth !== width) {
                width = el.clientWidth;
                setMeasured(new Map());
                setEpoch((n) => n + 1);
            }
            // Where the rows begin within everything the box scrolls: the tabs and the header are
            // above them, and a window that ignores that is out by their height. Taken from the two
            // boxes because offsetTop answers about a positioned ancestor, not about the box.
            const offset = box.scrollTop + (el.getBoundingClientRect().top - box.getBoundingClientRect().top);
            setScroll({ top: Math.max(0, box.scrollTop - Math.max(0, offset)), viewport: box.clientHeight });
        };
        measure();
        box?.addEventListener("scroll", measure, { passive: true });
        const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
        if (box) observer?.observe(box);
        observer?.observe(el);
        return () => {
            box?.removeEventListener("scroll", measure);
            observer?.disconnect();
        };
    }, []);

    const offsets = useMemo(() => listOffsets(count, measured, estimate), [count, measured, estimate]);
    const [from, to] = scroll.viewport
        ? listWindow(offsets, scroll.top, scroll.viewport)
        : ([0, Math.min(count, 12)] as [number, number]);

    // A row reports its real height once, and only a change worth moving anything for is kept.
    const remember = (index: number, height: number): void =>
        setMeasured((prev) => {
            if (Math.abs((prev.get(index) ?? estimate) - height) < 1) return prev;
            const next = new Map(prev);
            next.set(index, height);
            return next;
        });

    const nearEnd = useRef(onNearEnd);
    nearEnd.current = onNearEnd;
    const atEnd = count > 0 && to >= count;
    useEffect(() => {
        if (atEnd) nearEnd.current();
    }, [atEnd, count]);

    const shown = [];
    for (let i = from; i < to; i++) shown.push(i);
    return (
        <div ref={ref} className="mx_SharedMedia_rows" style={{ height: offsets[count] }}>
            {shown.map((index) => (
                <MeasuredRow key={`${epoch}-${index}`} top={offsets[index]} onHeight={(h) => remember(index, h)}>
                    {children(index)}
                </MeasuredRow>
            ))}
        </div>
    );
}

/** One row, placed where the layout says and reporting what it turned out to be worth. */
function MeasuredRow({
    top,
    onHeight,
    children,
}: {
    top: number;
    onHeight: (height: number) => void;
    children: JSX.Element;
}): JSX.Element {
    const ref = useRef<HTMLDivElement>(null);
    const report = useRef(onHeight);
    report.current = onHeight;
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        report.current(el.offsetHeight);
        if (typeof ResizeObserver === "undefined") return;
        // A link preview's image arrives later and changes the row's height with it.
        const observer = new ResizeObserver(() => report.current(el.offsetHeight));
        observer.observe(el);
        return () => observer.disconnect();
    }, []);
    return (
        <div ref={ref} className="mx_SharedMedia_row_placed" style={{ top }}>
            {children}
        </div>
    );
}

/* Must match the grid's CSS: three equal columns, a hairline between them, and a month heading. */
const GRID_COLUMNS = 3;
const GRID_GAP = 1;
const MONTH_HEADER = 32;

/** "September 2026", in the reader's own language. */
function monthLabel(time: number): string {
    return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(new Date(time));
}

/**
 * Lays the grid out and keeps only what is on screen in the DOM.
 *
 * A chat with twenty thousand photos is an ordinary chat, and a cell for each of them is tens of
 * thousands of elements and decoded images - enough to make scrolling stutter and the tab take
 * seconds to appear. The cells are square and the columns equal, so every row's position follows
 * from the container's width (sharedMediaLayout.ts) and the rest is a window onto that.
 */
function useGridLayout(
    items: MatrixEvent[],
    total?: number,
    /** The server's count per month: with it the whole history is laid out as it will look. */
    months: MonthSpan[] = [],
    index?: IndexPlaces,
): {
    ref: React.RefObject<HTMLDivElement | null>;
    rows: MediaRow[];
    height: number;
    window: [number, number];
    /** How wide a square cell is, which is zero until the column has been measured. */
    cell: number;
    month?: { section: MediaSection; headingVisible: boolean };
    /**
     * The scroll, in the scrolling box's own terms rather than the column's: the scrubber's handle
     * has to span the whole of what scrolls, tabs and header included, or it reaches the end of its
     * track before the list reaches its end. `offset` is where the column starts inside that.
     */
    scroll: { top: number; viewport: number; content: number; offset: number; belowScreen?: number; floor?: number };
    seek: (top: number) => void;
    /** Hides the native scrollbar, for as long as the scrubber is standing in for it. */
    setScrubbed: (on: boolean) => void;
} {
    const ref = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);
    const [scroll, setScroll] = useState<{
        top: number;
        viewport: number;
        content: number;
        offset: number;
        belowScreen?: number;
        floor?: number;
    }>({ top: 0, viewport: 0, content: 0, offset: 0 });

    // Measured before the first paint: the column's width sets every row's height, so measuring
    // after it would show one frame of rows piled on top of each other.
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const box = scrollParentOf(el);
        const measure = (): void => {
            setWidth(el.clientWidth);
            if (!box) return;
            /*
             * Measured in the scrolling box's own terms, because the column is not the only thing in
             * it: the tabs and the header sit above it. Deriving the scroll from the column alone
             * leaves that chrome out, and everything reading it is then short by exactly its height
             * - the handle reaches the end of its track before the list reaches its end.
             *
             * `offset` is where the column begins within everything the box scrolls, taken from the
             * two boxes rather than from offsetTop: offsetTop answers about whichever ancestor
             * happens to be positioned, and the wrapper the handle floats in is one.
             */
            const boxRect = box.getBoundingClientRect();
            const offset = box.scrollTop + (el.getBoundingClientRect().top - boxRect.top);
            // What of the box is past the bottom of the screen, which the track must stop short of.
            const screen = UIStore.instance.windowHeight;
            setScroll({
                top: box.scrollTop,
                viewport: box.clientHeight,
                content: box.scrollHeight,
                offset: Math.max(0, offset),
                belowScreen: Math.max(0, Math.round(boxRect.bottom - screen)),
                floor: floatingFloor(box),
            });
        };
        measure();
        box?.addEventListener("scroll", measure, { passive: true });
        // Both matter: the panel is resizable, and the column's width sets every row's height.
        const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
        observer?.observe(el);
        if (box) observer?.observe(box);
        // The box need not change size when the window does (it can reach past the bottom of the
        // screen), but how much of it is past the screen does, and the track has to stop short of that.
        UIStore.instance.on(UI_EVENTS.Resize, measure);
        return () => {
            box?.removeEventListener("scroll", measure);
            observer?.disconnect();
            UIStore.instance.off(UI_EVENTS.Resize, measure);
        };
    }, []);

    /*
     * The bars that float over the top of the box come and go without the box or the column changing
     * size (the selection bar replaces the header the moment something is ticked), so nothing above
     * is told. Read again after every render, and kept only when it differs.
     */
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- after every render, on purpose; it settles at once
    useLayoutEffect(() => {
        const floor = floatingFloor(scrollParentOf(ref.current));
        setScroll((prev) => (prev.floor === floor || (prev.floor === undefined && !floor) ? prev : { ...prev, floor }));
    });

    const cell = width ? (width - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS : 0;
    /*
     * The column stands for the whole history, not the part of it that has loaded: what is missing
     * is older, so it is laid out below as rows of placeholders. Without it the column grows under
     * the reader as pages arrive, the scrollbar misreports how much there is, and the scrubber can
     * only reach what has already been fetched - the opposite of what it is for.
     */
    const { rows, height } = useMemo(() => {
        const metrics = { header: MONTH_HEADER, cell, gap: GRID_GAP };
        return months.length
            ? sparseRows(items, months, GRID_COLUMNS, metrics, index)
            : mediaRows(items, GRID_COLUMNS, metrics, total);
    }, [items, cell, total, months, index]);
    /*
     * Held still while rows arrive above what is being looked at.
     *
     * After a jump, paging carries on from the newest history, which lands above the month jumped to;
     * at the same scroll offset the column slid under the reader and showed somewhere far higher up.
     * The item at the top of the viewport is noted after every layout, and put back where it was when
     * the rows change. At the very top nothing is held, so new media still shows there.
     */
    const anchor = useRef<ScrollAnchor | undefined>(undefined);
    useLayoutEffect(() => {
        const box = scrollParentOf(ref.current);
        const held = anchor.current;
        if (!box || !held) return;
        const top = anchoredTop(rows, items, held);
        if (top === undefined) return;
        const want = scroll.offset + top;
        if (Math.abs(box.scrollTop - want) > 1) box.scrollTop = want;
        // Only when the rows change: a scroll moving the anchor is the reader's doing, not a jump.
        // oxlint-disable-next-line react-hooks/exhaustive-deps
    }, [rows]);
    useLayoutEffect(() => {
        const box = scrollParentOf(ref.current);
        if (!box) return;
        const y = box.scrollTop - scroll.offset;
        anchor.current = y > 0 ? anchorAt(rows, items, y) : undefined;
    });
    // Before the first measurement there is no height to window against, so show the first screenful
    // rather than nothing: the measurement lands on the same frame and the window takes over.
    const shown = cell
        ? visibleRows(rows, Math.max(0, scroll.top - scroll.offset), scroll.viewport || 800)
        : ([0, Math.min(rows.length, 12)] as [number, number]);
    // Told where to go in the box's own terms, since that is what the handle stands for.
    const seek = useCallback((top: number) => {
        const box = scrollParentOf(ref.current);
        if (box) box.scrollTop = top;
    }, []);

    /*
     * The scrubber replaces the scrollbar rather than joining it: two things to drag down the same
     * edge, one of which names the month and one of which does not, is a choice nobody wants to make.
     * Marked on the box itself rather than by naming a container, because which element scrolls
     * depends on where the grid is being shown - and only while the scrubber is really there to
     * replace it, or the reader is left with neither.
     */
    const setScrubbed = useCallback((on: boolean) => {
        const box = scrollParentOf(ref.current);
        if (!box) return;
        if (on) box.setAttribute("data-mx-scrubbed", "");
        else box.removeAttribute("data-mx-scrubbed");
    }, []);

    return {
        ref,
        rows,
        height,
        window: shown,
        cell,
        month: sectionAt(rows, Math.max(0, scroll.top - scroll.offset)),
        scroll,
        seek,
        setScrubbed,
    };
}

/**
 * Telegram's date scrubber: a handle down the edge of the grid that carries the whole history.
 *
 * The scrollbar can only say "somewhere in the middle of twenty thousand photos", which is no help
 * when the question is "last August". Dragging this moves through the column by position and names
 * the month under the handle as it goes, so a date can be found by aiming at it.
 */
function DateScrubber({
    rows,
    scroll,
    seek,
    months,
    onPickMonth,
}: {
    rows: MediaRow[];
    scroll: { top: number; viewport: number; content: number; offset: number; belowScreen?: number; floor?: number };
    seek: (top: number) => void;
    /**
     * What the whole history holds per month, from the server's index. With this the bar addresses
     * history that has never been loaded, which is the difference between scrubbing the column and
     * scrubbing the chat. Empty in an encrypted room, or against a homeserver with no index, and then
     * everything below falls back to naming what is loaded.
     */
    months: MonthSpan[];
    /** Called once the bar is let go on a month, to go and fetch it. */
    onPickMonth: (month: MonthSpan) => void;
}): JSX.Element | null {
    /*
     * Telegram iOS's scrubber (SparseItemGridScrollingArea.swift): a thin bar at the edge and the month
     * in a pill beside it, shown while the grid moves and gone two seconds after it stops. The bar or the
     * pill is grabbed and dragged; the list follows the finger by how far it moves, not to where it is.
     * Held still for 0.2s under a finger, the pill slides out from under it.
     */
    // Where the drag has taken the bar, while it is down (see the note on following the finger).
    const [held, setHeld] = useState<number | null>(null);
    const [grabbed, setGrabbed] = useState(false);
    const [active, setActive] = useState(false);
    const drag = useRef<{ y: number; at: number; moved: boolean; touch: boolean; timer?: number } | null>(null);
    // Everything the box can scroll, which includes the tabs and header above the column.
    const span = scroll.content - scroll.viewport;
    const track = scrubberTrackHeight(scroll);
    /*
     * With the server's counts the column is the whole history (sparseRows), so a position on the bar
     * is a real position: the month under it is read off the rows, and letting go needs no fetch and
     * no scroll of its own - the placeholders there load themselves. Without them the bar stands for
     * history the column does not hold, and letting go fetches the month and scrolls to it.
     */
    const sparse = months.length > 0;

    // Shown while scrolling, and for two seconds after, as Telegram's activity timer does.
    const first = useRef(true);
    useEffect(() => {
        if (first.current) {
            first.current = false;
            return;
        }
        setActive(true);
        const timer = window.setTimeout(() => setActive(false), 2000);
        return () => window.clearTimeout(timer);
    }, [scroll.top]);

    const current = span > 0 ? Math.min(1, Math.max(0, scroll.top / span)) : 0;
    /*
     * The bar follows the finger rather than the scroll position while held: at either end the column
     * stops moving before the finger does, and a bar that stopped with it would be left behind by the
     * thing dragging it.
     */
    const at = held ?? current;

    useEffect(() => {
        if (held === null) return;
        const move = (e: PointerEvent): void => {
            const d = drag.current;
            if (!d) return;
            if (!d.moved) {
                d.moved = true;
                window.clearTimeout(d.timer);
                if (d.touch) setGrabbed(true);
            }
            const next = scrubberDragAt(d.at, e.clientY - d.y, track);
            setHeld(next);
            // Only where there is something to scroll; the month is still picked on release.
            if (span > 0) seek(next * span);
        };
        const up = (): void => {
            window.clearTimeout(drag.current?.timer);
            // On release, not during the drag: a fetch per pointermove would be a request every frame.
            if (drag.current?.moved && !sparse) {
                const picked = monthAt(months, held);
                if (picked) onPickMonth(picked);
            }
            drag.current = null;
            setGrabbed(false);
            setHeld(null);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
        return () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            window.removeEventListener("pointercancel", up);
        };
    }, [held, months, onPickMonth, seek, span, track, sparse]);

    if (!scrubberWorthIt(scroll.viewport, scroll.content, months)) return null;
    // The month at the bar: from the server's counts where we have them, so the label is right for
    // history that is not loaded, and from the column itself otherwise.
    const overall = sparse ? undefined : monthAt(months, at);
    const under = overall ?? sectionAt(rows, Math.max(0, at * span - scroll.offset))?.section;
    const lineTop = scrubberLineTop(at, track);
    const dragging = held !== null;
    const grab = (e: React.PointerEvent): void => {
        e.preventDefault();
        e.stopPropagation();
        /*
         * Held still for 0.2s: grabbed, so the pill moves out from under the finger. Only for a finger:
         * a mouse pointer covers nothing, and the pill running off across the grid looked like it was
         * getting away rather than making room.
         */
        const touch = e.pointerType === "touch";
        drag.current = {
            y: e.clientY,
            at,
            moved: false,
            touch,
            timer: touch ? window.setTimeout(() => setGrabbed(true), 200) : undefined,
        };
        setHeld(at);
    };
    return (
        <div
            className="mx_SharedMedia_scrubber"
            // As long as what can be seen of it, which is not the same as the viewport.
            style={{ height: track }}
            data-active={active || dragging || undefined}
            data-dragging={dragging || undefined}
            data-grabbed={grabbed || undefined}
        >
            <div className="mx_SharedMedia_scrubberLine" style={{ insetBlockStart: lineTop }} onPointerDown={grab} />
            {under && (
                <div
                    className="mx_SharedMedia_scrubberDate"
                    style={{ insetBlockStart: scrubberPillTop(lineTop) }}
                    onPointerDown={grab}
                >
                    {/* A month's before_ts is its newest item's own time, so it names the month. */}
                    {monthLabel("month" in under ? under.before_ts : under.time)}
                </div>
            )}
        </div>
    );
}

function MediaGrid({
    room,
    items,
    selection,
    total,
    onNearEnd,
    months,
    index,
    onSeekDate,
    onLoadPlaces,
}: {
    room: Room;
    items: MatrixEvent[];
    selection: Selection;
    total?: number;
    /** Called when the window reaches the last row there is, so the next page can be fetched. */
    onNearEnd: () => void;
    /** What the whole history holds per month, for the scrubber. Empty without a server index. */
    months: MonthSpan[];
    /** Where the items loaded by place sit in the server's index, and which places hold nothing. */
    index: IndexPlaces;
    /** Fetches a month and returns once it is in, so the column can then be scrolled to it. */
    onSeekDate: (ts: number) => Promise<boolean>;
    /** Loads a stretch of the server's index by place. */
    onLoadPlaces: (start: number, count: number) => Promise<void>;
}): JSX.Element {
    const {
        ref,
        rows,
        height,
        window: shown,
        cell,
        month,
        scroll,
        seek,
        setScrubbed,
    } = useGridLayout(items, total, months, index);

    // The scrollbar goes only while the thing replacing it is usable, by the scrubber's own rule.
    const usable = scrubberWorthIt(scroll.viewport, scroll.content, months);
    useEffect(() => {
        setScrubbed(usable);
        return () => setScrubbed(false);
    }, [usable, setScrubbed]);

    /*
     * Go to the month the scrubber was let go on: fetch that stretch, then put it under the top of
     * the column.
     *
     * The scroll has to wait for the fetch, because until it lands there is no row to scroll to -
     * rowAtTime reads the rows the grid actually holds. `rows` is captured per render and the fetch
     * makes new ones, so the position is worked out in an effect once they arrive rather than here.
     */
    const [goingTo, setGoingTo] = useState<number | null>(null);
    const pickMonth = useCallback(
        (picked: MonthSpan) => {
            void onSeekDate(picked.before_ts).then(() => setGoingTo(picked.before_ts));
        },
        [onSeekDate],
    );
    useEffect(() => {
        if (goingTo === null) return;
        const row = rowAtTime(rows, items, goingTo);
        seek(rows[row]?.top ?? 0);
        setGoingTo(null);
    }, [goingTo, rows, items, seek]);
    /*
     * With room reserved at the bottom for what has not loaded, the end of the column is nowhere
     * near the end of the rows - so reaching the last row is what asks for the next page, rather
     * than something at the very bottom that a reader would have to scroll past the gap to meet.
     */
    /*
     * With the server's counts every month is already laid out, placeholders and all, and each
     * placeholder is a place in the server's index - so what is on screen loads in one request for
     * exactly those places, wherever the reader has scrolled or scrubbed to. Then a screen either
     * side, so it is there before the reader is. Every place a request covers comes back settled (an
     * item, or known to hold nothing), so the same stretch is not asked for again.
     */
    const sparse = months.length > 0;
    const around = visibleRows(rows, Math.max(0, scroll.top - scroll.offset - scroll.viewport), scroll.viewport * 3);
    const onScreen = sparse ? placeholderTarget(rows, shown) : undefined;
    const nearby = sparse ? placeholderTarget(rows, around) : undefined;
    const onScreenStart = onScreen?.start;
    const onScreenCount = onScreen?.count;
    const nearbyStart = nearby?.start;
    const nearbyCount = nearby?.count;
    useEffect(() => {
        if (onScreenStart !== undefined && onScreenCount !== undefined) {
            void onLoadPlaces(onScreenStart, onScreenCount);
        }
        if (nearbyStart !== undefined && nearbyCount !== undefined && nearbyStart !== onScreenStart) {
            void onLoadPlaces(nearbyStart, nearbyCount);
        }
    }, [onScreenStart, onScreenCount, nearbyStart, nearbyCount, onLoadPlaces]);

    const lastReal = rows.reduce((last, row, i) => (row.kind === "pending" ? last : i), -1);
    // Paging from the top is for a layout without the counts; the sparse one loads what is on screen.
    const atEnd = !sparse && lastReal >= 0 && shown[1] > lastReal;
    // Through a ref, and keyed on how much there is rather than on the callback: an identity that
    // changes each render would ask for the next page on every render, for ever.
    const nearEnd = useRef(onNearEnd);
    nearEnd.current = onNearEnd;
    useEffect(() => {
        if (atEnd) nearEnd.current();
    }, [atEnd, lastReal]);
    const drag = useDragSelect(items, selection, ref);
    const itemMenu = useItemMenu();
    const [menuFor, setMenuFor] = useState<number | null>(null);
    const range = useCallback(
        (from: number, to: number) => selection.setMany(items.slice(Math.min(from, to), Math.max(from, to) + 1), true),
        [items, selection],
    );
    const open = useCallback(
        (index: number) => {
            if (chatColumnsEnabled()) {
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
        /*
         * A plain block around the two of them.
         *
         * The handle floats beside the column rather than sitting inside it: inside, the
         * column clips its overflow to keep its corners, which makes it the box a sticky child
         * sticks within - so the handle scrolled away with the pictures. A float has no effect
         * on a flex item either, and the tab's content is a flex column, so dropped straight in
         * there it stops floating and becomes a bar in the flow. This block is neither flex nor
         * clipping, which is what the float and the stickiness each need.
         */
        <div
            className="mx_SharedMedia_column"
            // Where the floating bars end, so what floats beside the column keeps clear of them.
            style={{ "--SharedMedia-floor": `${scroll.floor ?? 0}px` } as React.CSSProperties}
        >
            {/*
             * A dock with no height, pinned to the top of the scroll: the track hangs from it. Floated,
             * the track was a box as tall as the screen, and the grid - which clips its corners, and so
             * cannot flow round a float - was pushed below all of it: a screen of nothing above the media.
             */}
            <div className="mx_SharedMedia_scrubberDock">
                <DateScrubber rows={rows} scroll={scroll} seek={seek} months={months} onPickMonth={pickMonth} />
            </div>
            <div className="mx_SharedMedia_grid" ref={ref} style={{ height }}>
                {/* The month at the top, but only once its own heading has scrolled away - otherwise the
                    two of them say the same thing one under the other. */}
                {month && !month.headingVisible && (
                    <div className="mx_SharedMedia_monthPill">{monthLabel(month.section.time)}</div>
                )}
                {rows.slice(shown[0], shown[1]).map((row) =>
                    row.kind === "header" ? (
                        <h4
                            key={`h-${row.section.key}`}
                            className="mx_SharedMedia_month"
                            style={{ top: row.top, height: row.height }}
                        >
                            {monthLabel(row.section.time)}
                        </h4>
                    ) : row.kind === "pending" ? (
                        <div
                            key={`p-${row.top}`}
                            className="mx_SharedMedia_gridRow"
                            style={{ top: row.top, height: row.height }}
                            aria-hidden
                        >
                            {Array.from({ length: row.count }, (_, i) => (
                                // Not a grid item: there is nothing here to open, select or describe.
                                <span key={i} className="mx_SharedMedia_pending" />
                            ))}
                        </div>
                    ) : (
                        <div
                            key={`r-${row.indices[0]}`}
                            className="mx_SharedMedia_gridRow"
                            style={{ top: row.top, height: row.height }}
                        >
                            {row.indices.map((i) => (
                                <GridThumb
                                    key={items[i].getId()}
                                    event={items[i]}
                                    selection={selection}
                                    onOpen={() => open(i)}
                                    index={i}
                                    size={thumbSizeFor(cell, window.devicePixelRatio || 1)}
                                    drag={drag}
                                    onRange={range}
                                    onContextMenu={(e, touch) => {
                                        itemMenu.onContextMenu(e, touch);
                                        setMenuFor(i);
                                    }}
                                />
                            ))}
                            {Array.from({ length: row.placeholders ?? 0 }, (_, i) => (
                                <span key={`p${i}`} className="mx_SharedMedia_pending" aria-hidden />
                            ))}
                        </div>
                    ),
                )}
            </div>
            {itemMenu.menu && menuFor !== null && items[menuFor] && (
                <ItemContextMenu
                    room={room}
                    event={items[menuFor]}
                    at={itemMenu.menu}
                    onFinished={itemMenu.close}
                    onOpen={() => open(menuFor)}
                    onSelect={() => {
                        drag.setAnchor(menuFor);
                        selection.toggle(items[menuFor]);
                    }}
                />
            )}
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

/** A list row that answers a right-click with the item's menu, except on a link, which keeps the browser's own. */
function MenuRow({
    event,
    room,
    selection,
    children,
}: {
    event: MatrixEvent;
    room: Room;
    selection: Selection;
    children: React.ReactNode;
}): JSX.Element {
    const itemMenu = useItemMenu();
    return (
        <div
            onContextMenu={(e) => {
                if ((e.target as Element).closest("a")) return;
                itemMenu.onContextMenu(e, false);
            }}
        >
            <Selectable event={event} selection={selection}>
                {children}
            </Selectable>
            {itemMenu.menu && (
                <ItemContextMenu
                    room={room}
                    event={event}
                    at={itemMenu.menu}
                    onFinished={itemMenu.close}
                    onSelect={() => selection.toggle(event)}
                />
            )}
        </div>
    );
}

/**
 * A link: the message as the timeline renders it, so its mentions are the people's names and its URL
 * preview is the same card Telegram shows, with who sent it underneath.
 */
function LinkRow({ event, room }: { event: MatrixEvent; room: Room }): JSX.Element {
    // The same decision the timeline makes, so a room whose previews are off doesn't fetch any here.
    const showUrlPreview = useContext(RoomContext).showTimelineUrlPreview;
    return (
        <div className="mx_SharedMedia_link">
            <div className="mx_SharedMedia_linkText">
                <MessageEvent mxEvent={event} permalinkCreator={undefined} showUrlPreview={showUrlPreview} />
            </div>
            <RowMeta event={event} room={room} />
        </div>
    );
}

/** An audio message as the tabs read it: how long it plays, wherever the sender put that. */
type AudioEventContent = FileContent & { "info"?: AudioInfo; "org.matrix.msc1767.audio"?: { duration?: number } };

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

/**
 * What stands in for the next page while it loads: tiles the size of the ones that will replace them
 * (a row of the grid's squares, or a list row at its estimated height), so nothing moves when they do.
 */
function SkeletonRows({ tab }: { tab: SharedMediaTab }): JSX.Element {
    if (tab === "media") {
        return (
            <div className="mx_SharedMedia_skeletonTiles" data-testid="shared-media-skeleton" aria-hidden>
                {Array.from({ length: GRID_COLUMNS }, (_, i) => (
                    <span key={i} className="mx_SharedMedia_pending" />
                ))}
            </div>
        );
    }
    return (
        <div
            className="mx_SharedMedia_skeletonRow mx_SharedMedia_pending"
            data-testid="shared-media-skeleton"
            style={{ height: ROW_ESTIMATE[tab] ?? 64 }}
            aria-hidden
        />
    );
}

function TabContent({
    loader,
    tab,
    filter,
    selection,
    total,
}: {
    loader: SharedMediaLoader;
    tab: SharedMediaTab;
    filter: MediaFilter;
    selection: Selection;
    /** How many the room holds in all, from the homeserver's counts, where it can say. */
    total?: number;
}): JSX.Element {
    const state = useTabState(loader, tab);
    const { loading, done } = state;
    const items = useMemo(
        () => (tab === "media" ? state.items.filter((e) => matchesMediaFilter(e, filter)) : state.items),
        [state.items, tab, filter],
    );
    /*
     * What the whole history holds per month, so the scrubber addresses the chat rather than the
     * column. Asked per tab, once, and empty where the homeserver keeps no index - which is every
     * encrypted room, and where the scrubber goes back to naming only what is loaded.
     */
    const [months, setMonths] = useState<MonthSpan[]>([]);
    useEffect(() => {
        let alive = true;
        setMonths([]);
        void loader.monthCounts(tab).then((found) => {
            if (alive) setMonths(found);
        });
        return () => {
            alive = false;
        };
    }, [loader, tab]);
    /*
     * With the server's counts the grid loads what is on screen by its place, wherever the reader
     * has scrolled to, so there is no "next page" for the end of the list to ask for.
     */
    const sparse = tab === "media" && months.length > 0;
    const sentinel = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = sentinel.current;
        if (!el || done || sparse) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((e) => e.isIntersecting)) void loader.loadMore(tab);
            },
            { rootMargin: "400px" },
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [loader, tab, done, sparse, items.length, loading]);

    const seekDate = useCallback((ts: number) => loader.seekTo(tab, ts), [loader, tab]);
    const loadPlaces = useCallback(
        (start: number, count: number) => loader.loadPlaces(tab, start, count),
        [loader, tab],
    );
    // What the filter hides still has its place in the index: to the grid, those places hold nothing.
    const index = useMemo<IndexPlaces>(() => {
        if (items.length === state.items.length) return { places: state.places, empty: state.empty };
        const shown = new Set(items.map((e) => e.getId()));
        const empty = new Set(state.empty);
        for (const [id, place] of state.places) if (!shown.has(id)) empty.add(place);
        return { places: state.places, empty };
    }, [items, state.items, state.places, state.empty]);

    // The grid draws its own placeholders for what the server says is still to come.
    const pendingBelow = tab === "media" && (total ?? 0) > items.length;
    const room = loader.room;
    let list: JSX.Element | null = null;
    if (items.length) {
        if (tab === "media") {
            list = (
                <MediaGrid
                    room={room}
                    items={items}
                    selection={selection}
                    total={total}
                    onNearEnd={() => void loader.loadMore(tab)}
                    months={months}
                    index={index}
                    onSeekDate={seekDate}
                    onLoadPlaces={loadPlaces}
                />
            );
        } else {
            list = (
                <VirtualRows
                    count={items.length}
                    estimate={ROW_ESTIMATE[tab] ?? 64}
                    onNearEnd={() => void loader.loadMore(tab)}
                >
                    {(index) => (
                        <MenuRow event={items[index]} room={room} selection={selection}>
                            {tab === "links" ? (
                                <LinkRow event={items[index]} room={room} />
                            ) : tab === "files" ? (
                                <BodyRow event={items[index]} room={room} />
                            ) : (
                                <AudioRow event={items[index]} room={room} />
                            )}
                        </MenuRow>
                    )}
                </VirtualRows>
            );
        }
    }
    return (
        <div className={`mx_SharedMedia_content mx_SharedMedia_content_${tab}`} role="tabpanel">
            {list}
            {!items.length && done && <div className="mx_SharedMedia_empty">{EMPTY_LABELS[tab]()}</div>}
            {/* Only where there is a next page to ask for, and then only skeletons while it comes: a
                spinner is a different shape from what it turns into, and the list moves when it goes. */}
            {!done && !sparse && (
                <div ref={sentinel} className="mx_SharedMedia_more">
                    {loading && !pendingBelow && <SkeletonRows tab={tab} />}
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
}: {
    loader: SharedMediaLoader;
    tab: SharedMediaTab;
    filter: MediaFilter;
    setFilter: (f: MediaFilter) => void;
}): JSX.Element {
    const state = useTabState(loader, tab);
    const byKind = useRoomKindCounts(loader.room);
    const selection = useSelection();
    const selected = useMemo(
        () => state.items.filter((ev) => selection.ids.has(ev.getId() ?? "")),
        [state.items, selection.ids],
    );
    const subtitle = tabSubtitle(tab, state, filter, byKind);
    const total = byKind ? tabCountsFromStats(byKind)[tab] : undefined;
    return (
        <>
            {selection.ids.size > 0 ? (
                <SelectionBar room={loader.room} events={selected} selection={selection} />
            ) : (
                <div className="mx_SharedMedia_paneHeader">
                    <div className="mx_SharedMedia_subtitle">{subtitle}</div>
                    <TabMenu tab={tab} filter={filter} onChange={setFilter} onSelect={selection.start} />
                </div>
            )}
            <TabContent loader={loader} tab={tab} filter={filter} selection={selection} total={total} />
        </>
    );
}

/** tweb .menu-horizontal-div: pill tabs whose highlight slides to the active one (--tabs-transition). */
function Tabs({
    tabs,
    active,
    onChange,
}: {
    tabs: SharedMediaTab[];
    active: SharedMediaTab;
    onChange: (tab: SharedMediaTab) => void;
}): JSX.Element {
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
            {tabs.map((tab) => (
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
                <SharedMediaTabBody key={tab} loader={loader} tab={tab} filter={filter} setFilter={setFilter} />
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
    const [chosen, setTab] = useState<SharedMediaTab>("media");
    const tabs = useVisibleSharedMediaTabs(loader);
    // tweb: when the open tab is hidden the first one left opens instead.
    const tab = tabs.includes(chosen) ? chosen : tabs[0];
    // Keep the one left open as the choice, so the tab coming back later doesn't pull the reader off it.
    useEffect(() => setTab(tab), [tab]);
    const [sentinel, stuck] = useStuck();
    const [filter, setFilter] = useState<MediaFilter>({ photos: true, videos: true });
    const roomContext = useContext(RoomContext);
    return (
        <ScopedRoomContextProvider {...roomContext} timelineRenderingType={TimelineRenderingType.File}>
            <BaseCard className="mx_SharedMedia" onClose={onClose} header={_t("bridge|shared_media|title")}>
                <div ref={sentinel} className="mx_SharedMedia_tabsSentinel" aria-hidden />
                <div
                    className={classNames("mx_SharedMedia_tabsRow", {
                        mx_SharedMedia_tabsRow_stuck: stuck,
                    })}
                    data-mx-floating
                >
                    <Tabs tabs={tabs} active={tab} onChange={setTab} />
                </div>
                <SharedMediaTabBody key={tab} loader={loader} tab={tab} filter={filter} setFilter={setFilter} />
            </BaseCard>
        </ScopedRoomContextProvider>
    );
}
