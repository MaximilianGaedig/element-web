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
import { mediaRows, type MediaRow, type MediaSection, sectionAt, visibleRows } from "../../../utils/sharedMediaLayout";
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
    // Links are text to the server, so only a list that has run out knows how many there are.
    const fromServer = byKind && tab !== "links" ? (tabCountsFromStats(byKind)[tab] ?? 0) : undefined;
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
    /** Sets a whole run at once, as dragging across the grid does; `on` picks selecting or clearing. */
    setMany: (events: MatrixEvent[], on: boolean) => void;
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
        const { default: QuestionDialog } = await import("../dialogs/QuestionDialog");
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
    index,
    drag,
}: {
    event: MatrixEvent;
    selection: Selection;
    onOpen: () => void;
    index: number;
    drag: DragSelect;
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
            onPointerDown={(e) => drag.onPointerDown(index, e)}
            onPointerEnter={() => drag.onPointerEnter(index)}
            // Ctrl/⌘-click starts a selection without going through the menu, as elsewhere in Element.
            onClick={(e) => {
                // The press that just finished a drag, or started a selection by being held, must
                // not also count as a tap on the picture.
                if (drag.swallowedClick()) return;
                if (selection.active || e.ctrlKey || e.metaKey) selection.toggle(event);
                else onOpen();
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

interface DragSelect {
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
function useDragSelect(items: MatrixEvent[], selection: Selection): DragSelect {
    const drag = useRef<{ from: number; last: number; on: boolean; before: Set<string> } | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const swallow = useRef(false);

    const idsOf = useCallback((from: number, to: number) => items.slice(from, to + 1), [items]);

    const reach = useCallback(
        (index: number) => {
            const d = drag.current;
            if (!d || index === d.last) return;
            const [lo, hi] = [Math.min(d.from, index), Math.max(d.from, index)];
            const [was, wasTo] = [Math.min(d.from, d.last), Math.max(d.from, d.last)];
            selection.setMany(idsOf(lo, hi), d.on);
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
            selection.setMany(idsOf(index, index), on);
        },
        [idsOf, selection],
    );

    useEffect(() => {
        const end = (): void => {
            clearTimeout(timer.current);
            drag.current = null;
        };
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
        return () => {
            window.removeEventListener("pointerup", end);
            window.removeEventListener("pointercancel", end);
            clearTimeout(timer.current);
        };
    }, []);

    return {
        onPointerDown: (index, e) => {
            // A touch captures the pointer to the element it started on, so without releasing it the
            // drag would never enter the neighbours and could only ever select the one item.
            e.currentTarget.releasePointerCapture?.(e.pointerId);
            swallow.current = false;
            if (selection.active) {
                begin(index, !selection.ids.has(items[index]?.getId() ?? ""));
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
function useGridLayout(items: MatrixEvent[]): {
    ref: React.RefObject<HTMLDivElement | null>;
    rows: MediaRow[];
    height: number;
    window: [number, number];
    month?: { section: MediaSection; headingVisible: boolean };
    scroll: { top: number; viewport: number };
    seek: (top: number) => void;
} {
    const ref = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);
    const [scroll, setScroll] = useState({ top: 0, viewport: 0 });

    // Measured before the first paint: the column's width sets every row's height, so measuring
    // after it would show one frame of rows piled on top of each other.
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const box = scrollParentOf(el);
        const measure = (): void => {
            setWidth(el.clientWidth);
            if (box) setScroll({ top: Math.max(0, box.scrollTop - el.offsetTop), viewport: box.clientHeight });
        };
        measure();
        box?.addEventListener("scroll", measure, { passive: true });
        // Both matter: the panel is resizable, and the column's width sets every row's height.
        const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
        observer?.observe(el);
        if (box) observer?.observe(box);
        return () => {
            box?.removeEventListener("scroll", measure);
            observer?.disconnect();
        };
    }, []);

    const cell = width ? (width - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS : 0;
    const { rows, height } = useMemo(
        () => mediaRows(items, GRID_COLUMNS, { header: MONTH_HEADER, cell, gap: GRID_GAP }),
        [items, cell],
    );
    // Before the first measurement there is no height to window against, so show the first screenful
    // rather than nothing: the measurement lands on the same frame and the window takes over.
    const shown = cell
        ? visibleRows(rows, scroll.top, scroll.viewport || 800)
        : ([0, Math.min(rows.length, 12)] as [number, number]);
    const seek = useCallback((top: number) => {
        const el = ref.current;
        const box = scrollParentOf(el);
        if (el && box) box.scrollTop = el.offsetTop + top;
    }, []);

    return { ref, rows, height, window: shown, month: sectionAt(rows, scroll.top), scroll, seek };
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
    height,
    scroll,
    seek,
}: {
    rows: MediaRow[];
    height: number;
    scroll: { top: number; viewport: number };
    seek: (top: number) => void;
}): JSX.Element | null {
    const track = useRef<HTMLDivElement>(null);
    const [dragging, setDragging] = useState(false);
    const span = height - scroll.viewport;

    const to = useCallback(
        (clientY: number) => {
            const box = track.current?.getBoundingClientRect();
            if (!box || box.height <= 0) return;
            const at = Math.min(1, Math.max(0, (clientY - box.top) / box.height));
            seek(at * span);
        },
        [seek, span],
    );

    useEffect(() => {
        if (!dragging) return;
        const move = (e: PointerEvent): void => to(e.clientY);
        const up = (): void => setDragging(false);
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
        return () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            window.removeEventListener("pointercancel", up);
        };
    }, [dragging, to]);

    // Nothing to scrub when the whole column already fits.
    if (span <= 0) return null;
    const at = Math.min(1, Math.max(0, scroll.top / span));
    const under = sectionAt(rows, scroll.top)?.section;
    return (
        <div
            ref={track}
            className="mx_SharedMedia_scrubber"
            data-dragging={dragging || undefined}
            onPointerDown={(e) => {
                e.preventDefault();
                setDragging(true);
                to(e.clientY);
            }}
        >
            <div className="mx_SharedMedia_scrubberHandle" style={{ insetBlockStart: `${at * 100}%` }}>
                {dragging && under && <span className="mx_SharedMedia_scrubberDate">{monthLabel(under.time)}</span>}
            </div>
        </div>
    );
}

function MediaGrid({ items, selection }: { items: MatrixEvent[]; selection: Selection }): JSX.Element {
    const drag = useDragSelect(items, selection);
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
    const { ref, rows, height, window: shown, month, scroll, seek } = useGridLayout(items);
    return (
        <div className="mx_SharedMedia_grid" ref={ref} style={{ height }}>
            {/* The month at the top, but only once its own heading has scrolled away - otherwise the
                two of them say the same thing one under the other. */}
            {month && !month.headingVisible && (
                <div className="mx_SharedMedia_monthPill">{monthLabel(month.section.time)}</div>
            )}
            <DateScrubber rows={rows} height={height} scroll={scroll} seek={seek} />
            {rows.slice(shown[0], shown[1]).map((row) =>
                row.kind === "header" ? (
                    <h4
                        key={`h-${row.section.key}`}
                        className="mx_SharedMedia_month"
                        style={{ top: row.top, height: row.height }}
                    >
                        {monthLabel(row.section.time)}
                    </h4>
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
                                drag={drag}
                            />
                        ))}
                    </div>
                ),
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
    const [tab, setTab] = useState<SharedMediaTab>("media");
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
                >
                    <Tabs active={tab} onChange={setTab} />
                </div>
                <SharedMediaTabBody key={tab} loader={loader} tab={tab} filter={filter} setFilter={setFilter} />
            </BaseCard>
        </ScopedRoomContextProvider>
    );
}
