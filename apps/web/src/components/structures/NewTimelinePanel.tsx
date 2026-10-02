/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from "react";
import {
    TimelineView,
    useCreateAutoDisposedViewModel,
    useViewModel,
    type TimelineItem,
    ReadMarker,
} from "@element-hq/web-shared-components";
import { InlineSpinner } from "@vector-im/compound-web";
import classNames from "classnames";

import {
    EventType,
    RoomEvent,
    type MatrixClient,
    type RelationType,
    type Relations,
    type Room,
} from "matrix-js-sdk/src/matrix";
import { RoomTimelineViewModel } from "../../viewmodels/room/timeline/RoomTimelineViewModel";
import { useMatrixClientContext } from "../../contexts/MatrixClientContext";
import { LegacyEventTileAdapter } from "../views/rooms/LegacyEventTileAdapter";
import type { IReadReceiptPosition } from "../views/rooms/ReadReceiptMarker";
import { receiptsByShownEvent } from "../../utils/telegram/receiptsByEvent";
import { useTypedEventEmitter } from "../../hooks/useEventEmitter";
import { isOneToOneRoom, bubbleTimelineEnabled, telegramTicksShown } from "../../utils/telegram/telegramLayout";
import MemberAvatar from "../views/avatars/MemberAvatar";
import PerMessageProfileAvatar from "../views/bridge/PerMessageProfileAvatar";
import type { GetRelationsForEvent, IReadReceiptProps } from "../views/rooms/EventTile";
import { Layout } from "../../settings/enums/Layout";
import { useSettingValue } from "../../hooks/useSettings";
import { _t } from "../../languageHandler";
import type { RoomPermalinkCreator } from "../../utils/permalinks/Permalinks";
import type EditorStateTransfer from "../../utils/EditorStateTransfer";
import { DateSeparatorWrapper } from "./DateSeparatorWrapper";
import { TgMessagesSkeleton } from "../views/telegram/TgMessagesSkeleton";

interface NewTimelinePanelProps {
    room: Room;
    highlightedEventId?: string;
    /**
     * How messages are laid out. RoomView watches this setting for us, so a change
     * arrives here as a new prop.
     */
    layout?: Layout;
    /** Keep the panel mounted but invisible (e.g. while search results are shown). */
    hidden?: boolean;
    /**
     * Whether this is the room on screen. A room kept mounted behind the one on screen (for instant
     * switching back) is not being read: it sends no read receipts, and going off screen does what
     * leaving the room does. Defaults to true. (Hiding it is the kept room's wrapper's job: see LoggedInView.)
     */
    active?: boolean;
    /** Used by tiles for permalinks in message bodies and context menus. */
    permalinkCreator?: RoomPermalinkCreator;
    /** Whether tiles render URL previews under messages. */
    showUrlPreview?: boolean;
    /** Whether tiles render reactions under messages. */
    showReactions?: boolean;
    /** Set while a message is being edited; the matching tile renders the edit composer. */
    editState?: EditorStateTransfer;
}

/** Everything a timeline row needs from the panel to draw itself. */
interface RenderItemContext {
    room: Room;
    highlightedId: string | null;
    effectiveLayout: Layout;
    permalinkCreator?: RoomPermalinkCreator;
    showUrlPreview?: boolean;
    showReactions?: boolean;
    isTwelveHour: boolean;
    alwaysShowTimestamps: boolean;
    editState?: EditorStateTransfer;
    getRelationsForEvent: GetRelationsForEvent;
    /** A one-to-one bubble chat needs no sender name over every message. */
    hideSender: boolean;
    /** Nor an avatar beside each one, when there is only one other person in the room. */
    hideAvatar: boolean;
    /** Whether the tiles are being drawn as Telegram bubbles; the tile cannot tell on its own. */
    telegramBubbles: boolean;
    /** Whether our messages carry ticks rather than readers' avatars (telegramTicksShown). */
    telegramTicks: boolean;
    /** Whether read receipts are shown at all (the "showReadReceipts" setting). */
    showReadReceipts: boolean;
    /** Who has read up to each drawn message. */
    readReceipts: ReadonlyMap<string, IReadReceiptProps[]>;
    /** Where each reader's avatar last was, which the receipts animate from; kept across renders. */
    readReceiptMap: Record<string, IReadReceiptPosition>;
    myUserId: string;
}

const NO_RECEIPTS: ReadonlyMap<string, IReadReceiptProps[]> = new Map();

/** Bubbles drawn where more history is being fetched, and over a chat that is slow to open. */
const LOADING_ROW_BUBBLES = 4;
const OPENING_BUBBLES = 20;

/** Draws one timeline row. Kept outside the component so it isn't redefined per render. */
function renderTimelineItem(item: TimelineItem, ctx: RenderItemContext): ReactNode {
    switch (item.kind) {
        case "date-separator":
            // The same view model as the old timeline, so the label and
            // jump-to-date menu behave identically in both.
            return (
                <DateSeparatorWrapper
                    key={item.key}
                    roomId={ctx.room.roomId}
                    ts={item.ts}
                    className="mx_TimelineDate"
                />
            );
        case "read-marker":
            // Rendered as a div because the timeline already puts each row in
            // its own list item.
            return (
                <ReadMarker
                    key={item.key}
                    eventId={item.key}
                    kind="current"
                    as="div"
                    className="mx_TimelineUnread"
                    label={_t("timeline|read_marker_new")}
                />
            );
        case "loading":
            // In the Telegram layout, the shape of the messages being fetched rather than a spinner.
            if (ctx.telegramBubbles) {
                return (
                    <div
                        key={item.key}
                        className="mx_NewTimelinePanel_loadingMessages"
                        aria-label={_t("common|loading")}
                        role="progressbar"
                    >
                        <TgMessagesSkeleton count={LOADING_ROW_BUBBLES} />
                    </div>
                );
            }
            return (
                <div key={item.key} className="mx_NewTimelinePanel_loading">
                    <InlineSpinner size={32} aria-label={_t("common|loading")} role="progressbar" />
                </div>
            );
        // Nothing produces gap rows yet. The old timeline draws nothing for a break in
        // history either, so until there is a design for one, neither do we.
        case "gap":
            return null;
        case "event": {
            // This id comes from the view model's snapshot and may no longer resolve: a
            // gappy sync can trigger a timeline reset, which drops every loaded event.
            // Rendering a tile without its event crashes, replacing the whole timeline
            // with an error, so leave the row empty until the next snapshot.
            /*
             * A message of ours that has not gone out yet is not in the room's timelines: the room
             * holds it apart as a pending event, where looking it up by id does not find it. The view
             * model lists those all the same - being sent, or failed - and each one drew as an empty
             * row: a failed message left the "not sent" mark on the chat and nothing in it to see.
             */
            const mxEvent =
                ctx.room.findEventById(item.key) ??
                ctx.room.getPendingEvents().find((pending) => pending.getId() === item.key);
            if (!mxEvent) return null;

            // For now, all events go through the legacy adapter.
            // As tiles are migrated to MVVM, this switch will
            // send migrated types to their shared views instead.
            /*
             * One avatar for a run of messages, at the end of the run, as Telegram places it. The
             * tile is shared with the old timeline, but being in a bubble timeline is something the
             * timeline has to tell it - and which message of a run carries the avatar is a decision
             * only the timeline can make.
             */
            const type = mxEvent.getType();
            // Which side a bubble is on already says it is ours, so our own messages carry no avatar.
            const own = ctx.telegramBubbles && mxEvent.getSender() === ctx.myUserId;
            const groupAvatar =
                ctx.telegramBubbles &&
                !ctx.hideAvatar &&
                mxEvent.getSender() !== ctx.myUserId &&
                !mxEvent.isState() &&
                (type === EventType.RoomMessage || type === EventType.Sticker || type.endsWith("poll.start"));
            const tile = (
                <LegacyEventTileAdapter
                    key={item.key}
                    mxEvent={mxEvent}
                    continuation={item.continuation}
                    lastInSection={item.lastInSection}
                    layout={ctx.effectiveLayout}
                    isSelectedEvent={ctx.highlightedId !== null && item.key === ctx.highlightedId}
                    // A tile treats any edit state it is given as its own, so
                    // only the message being edited may receive it.
                    editState={ctx.editState?.getEvent().getId() === item.key ? ctx.editState : undefined}
                    getRelationsForEvent={ctx.getRelationsForEvent}
                    permalinkCreator={ctx.permalinkCreator}
                    showUrlPreview={ctx.showUrlPreview}
                    showReactions={ctx.showReactions}
                    isTwelveHour={ctx.isTwelveHour}
                    alwaysShowTimestamps={ctx.alwaysShowTimestamps}
                    hideSender={ctx.hideSender}
                    hideAvatar={ctx.hideAvatar || groupAvatar || own}
                    telegramBubbles={ctx.telegramBubbles}
                    telegramTicks={ctx.telegramTicks}
                    showReadReceipts={ctx.showReadReceipts}
                    readReceipts={ctx.readReceipts.get(item.key)}
                    readReceiptMap={ctx.readReceiptMap}
                />
            );
            if (!groupAvatar) return tile;
            return (
                <div key={item.key} className="mx_NewTimelinePanel_senderMessage">
                    {tile}
                    {item.lastInSection && (
                        <div className="mx_NewTimelinePanel_senderAvatar">
                            <PerMessageProfileAvatar mxEvent={mxEvent} size="40px">
                                <MemberAvatar
                                    member={ctx.room.getMember(mxEvent.getSender() ?? "")}
                                    fallbackUserId={mxEvent.getSender()}
                                    size="40px"
                                    viewUserOnClick
                                />
                            </PerMessageProfileAvatar>
                        </div>
                    )}
                </div>
            );
        }
        default:
            return null;
    }
}

/**
 * New MVVM-based timeline panel, rendered behind the `feature_new_timeline` Labs flag.
 * Uses the shared TimelineView from shared-components with a RoomTimelineViewModel.
 */
export function NewTimelinePanel({
    room,
    highlightedEventId,
    layout,
    hidden,
    active = true,
    permalinkCreator,
    showUrlPreview,
    showReactions,
    editState,
}: Readonly<NewTimelinePanelProps>): JSX.Element {
    const client: MatrixClient = useMatrixClientContext();

    // Read here rather than passed in, so changing either setting redraws the tiles.
    const isTwelveHour = useSettingValue("showTwelveHourTimestamps");
    const alwaysShowTimestamps = useSettingValue("alwaysShowTimestamps");

    // Modern and Message Bubbles are fully supported. IRC layout is not yet: it
    // needs the draggable name column the old timeline provides, so fall back to
    // Modern for now (a known follow-up, listed on the tracking issue).
    const effectiveLayout = layout === Layout.IRC ? Layout.Group : (layout ?? Layout.Group);
    /*
     * Telegram bubbles, and what they imply about a one-to-one chat: no sender name over every
     * message, and no avatar beside each one, because there is only one other person in the room -
     * their ticks go where the avatar would have been instead.
     */
    const telegramBubbles = effectiveLayout === Layout.Bubble && bubbleTimelineEnabled();
    const isDirectBubbleChat = effectiveLayout === Layout.Bubble && isOneToOneRoom(room);
    const hideAvatar = isDirectBubbleChat && telegramBubbles;
    const readReceiptsStyle = useSettingValue("readReceiptsStyle");
    const telegramTicks = telegramTicksShown({
        room,
        layout: effectiveLayout,
        bubbles: telegramBubbles,
        readReceiptsStyle,
    });

    // Creating the view model does nothing on its own — it starts listening only
    // when start() is called in the effect below. React can build one of these and
    // throw it away, and anything it had already started would have leaked.
    const vm = useCreateAutoDisposedViewModel(
        () =>
            new RoomTimelineViewModel({
                client,
                room,
                initialEventId: highlightedEventId,
            }),
    );

    useEffect(() => {
        vm.setActive(active);
    }, [vm, active]);

    useEffect(() => {
        vm.start();
        // Disposal is handled by useCreateAutoDisposedViewModel; no cleanup needed here.
    }, [vm]);

    useEffect(() => {
        // Load the syntax highlighter up front. Code blocks fetch it the first time
        // one is shown, and if that arrives late the block re-wraps after its row
        // has been measured and the timeline jumps. Loading it now means the
        // highlighting is ready before the first code block is drawn.
        void import("highlight.js");
    }, []);

    // How a tile finds the reactions and edits attached to its message. Without
    // this, no reactions are drawn at all.
    const getRelationsForEvent = useCallback(
        (eventId: string, relationType: RelationType | string, eventType: EventType | string): Relations | undefined =>
            room.getUnfilteredTimelineSet().relations?.getChildEventsForEvent(eventId, relationType, eventType),
        [room],
    );

    const snapshot = useViewModel(vm);

    /*
     * Who has read how far, beside the messages - which the old timeline worked out for its tiles
     * and this one never did, so a group chat showed nobody's receipt at all. Recomputed as the rows
     * change and as receipts arrive; left out where ticks stand in for them.
     */
    const showReadReceipts = useSettingValue("showReadReceipts");
    const [receiptsSeen, setReceiptsSeen] = useState(0);
    useTypedEventEmitter(room, RoomEvent.Receipt, () => setReceiptsSeen((n) => n + 1));
    const readReceipts = useMemo(() => {
        if (!showReadReceipts || telegramTicks) return NO_RECEIPTS;
        const shown = new Set(snapshot.items.filter((item) => item.kind === "event").map((item) => item.key));
        return receiptsByShownEvent(client, room, room.getLiveTimeline().getEvents(), shown);
        // receiptsSeen stands for the room's receipts, which change without anything else here doing so.
    }, [client, room, snapshot.items, showReadReceipts, telegramTicks, receiptsSeen]); // eslint-disable-line react-hooks/exhaustive-deps
    const readReceiptMap = useRef<Record<string, IReadReceiptPosition>>({}).current;

    // How much the floating header and composer cover at each end. TgChatChrome measures them and
    // writes them onto the room body as custom properties; the virtualizer needs them as numbers,
    // because space it does not know about is space it will not scroll through — the last message
    // ends up stranded that far above the composer.
    const panelRef = useRef<HTMLDivElement | null>(null);
    const [clearance, setClearance] = useState({ start: 0, end: 0 });
    useEffect(() => {
        const el = panelRef.current;
        if (!el) return;
        const read = (): void => {
            const style = getComputedStyle(el);
            const px = (name: string): number => Math.round(parseFloat(style.getPropertyValue(name)) || 0);
            const next = { start: px("--tg-header-block"), end: px("--tg-composer-block") };
            setClearance((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
        };
        read();
        // The properties are written to the body's style attribute as the chrome is measured.
        const observer = new MutationObserver(read);
        const body = el.closest(".mx_RoomView_body");
        if (body) observer.observe(body, { attributes: true, attributeFilter: ["style"] });
        return () => observer.disconnect();
    }, []);
    const { highlightedEventId: highlightedId } = snapshot;

    // The date of the day being read, shown at the top of the timeline while scrolling.
    // The timeline's own separator, so the label reads exactly as the one in the list does;
    // TimelineView decides when it is shown.
    // Over a chat that is slow to open: the shape of a conversation, clear of what floats over the list.
    const renderPlaceholder = useCallback(
        (): ReactNode => (
            <TgMessagesSkeleton
                count={OPENING_BUBBLES}
                className="mx_TgMessagesSkeleton_opening"
                style={{ paddingTop: clearance.start, paddingBottom: clearance.end }}
            />
        ),
        [clearance.start, clearance.end],
    );
    const renderStickyDate = useCallback(
        (ts: number): ReactNode => (
            // Keyed by the day: the separator builds its view model once, from the timestamp it
            // was given, so without a new element per day the floating date keeps saying whatever
            // day it first mounted on — "Today", however far back the reader scrolls.
            <DateSeparatorWrapper
                key={ts}
                roomId={room.roomId}
                ts={ts}
                labelOnly
                className="mx_NewTimelinePanel_stickyDate mx_TimelineDate"
            />
        ),
        [room.roomId],
    );

    const renderItem = useCallback(
        (item: TimelineItem): ReactNode =>
            renderTimelineItem(item, {
                room,
                highlightedId,
                effectiveLayout,
                permalinkCreator,
                showUrlPreview,
                showReactions,
                isTwelveHour,
                alwaysShowTimestamps,
                editState,
                getRelationsForEvent,
                hideSender: isDirectBubbleChat,
                hideAvatar,
                telegramBubbles,
                telegramTicks,
                showReadReceipts,
                readReceipts,
                readReceiptMap,
                myUserId: client.getSafeUserId(),
            }),
        [
            room,
            highlightedId,
            effectiveLayout,
            permalinkCreator,
            showUrlPreview,
            showReactions,
            isTwelveHour,
            alwaysShowTimestamps,
            editState,
            getRelationsForEvent,
            isDirectBubbleChat,
            hideAvatar,
            telegramBubbles,
            telegramTicks,
            showReadReceipts,
            readReceipts,
            readReceiptMap,
            client,
        ],
    );

    return (
        <div
            ref={panelRef}
            className={classNames("mx_NewTimelinePanel mx_RoomView_messagePanel mx_RoomView_messageListWrapper", {
                mx_NewTimelinePanel_hidden: hidden,
                // The same hook the old timeline uses, so a one-to-one bubble chat is styled by the
                // rules that already exist rather than by a second set for this panel.
                mx_MessagePanel_noAvatars: hideAvatar,
            })}
        >
            <TimelineView
                vm={vm}
                renderItem={renderItem}
                renderStickyDate={renderStickyDate}
                // Telegram keeps the day's date pinned under the header, not only while scrolling.
                alwaysShowStickyDate={telegramBubbles}
                // ...and brings a new message up from behind the composer instead of jumping to it.
                animateNewMessages={telegramBubbles}
                renderPlaceholder={telegramBubbles ? renderPlaceholder : undefined}
                paddingStart={clearance.start}
                paddingEnd={clearance.end}
            />
        </div>
    );
}
