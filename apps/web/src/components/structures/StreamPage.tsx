/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { memo, useCallback, useContext, useRef, type JSX, type ReactNode } from "react";
import { EventType, KnownMembership, type MatrixEvent, type Room } from "matrix-js-sdk/src/matrix";
import { InlineSpinner } from "@vector-im/compound-web";
import { TimelineView, useCreateAutoDisposedViewModel, type TimelineItem } from "@element-hq/web-shared-components";

import RoomContext, { TimelineRenderingType, type RoomContextType } from "../../contexts/RoomContext";
import { ScopedRoomContextProvider } from "../../contexts/ScopedRoomContext";
import { SDKContext } from "../../contexts/SDKContext";
import { useMatrixClientContext } from "../../contexts/MatrixClientContext";
import { StreamViewModel } from "../../viewmodels/stream/StreamViewModel";
import { LegacyEventTileAdapter } from "../views/rooms/LegacyEventTileAdapter";
import { DateSeparatorWrapper } from "./DateSeparatorWrapper";
import RoomAvatar from "../views/avatars/RoomAvatar";
import { BridgedRoomAvatar } from "../views/bridge/BridgeNetworkIcon";
import { TgBackButton } from "../views/telegram/TgNavigation";
import { Layout } from "../../settings/enums/Layout";
import { EventPresentationContextProvider } from "../../utils/EventPresentationContextProvider";
import { reactionsBlockedReason } from "../../utils/bridge/roomFeatures";
import { useSettingValue } from "../../hooks/useSettings";
import { Action } from "../../dispatcher/actions";
import dis from "../../dispatcher/dispatcher";
import { type ViewRoomPayload } from "../../dispatcher/payloads/ViewRoomPayload";
import { _t } from "../../languageHandler";

/** Opens the room a run came from, at its first message. */
function openRoomAt(event: MatrixEvent): void {
    dis.dispatch<ViewRoomPayload>({
        action: Action.ViewRoom,
        room_id: event.getRoomId(),
        event_id: event.getId(),
        highlighted: true,
        metricsTrigger: undefined,
    });
}

/** The bar over a run of messages from one room: which conversation they are in, and the way into it. */
function RecipientBar({ room, first }: { room: Room; first: MatrixEvent }): JSX.Element {
    return (
        <button type="button" className="mx_StreamPage_recipientBar" onClick={() => openRoomAt(first)}>
            <BridgedRoomAvatar room={room}>
                <RoomAvatar room={room} size="24px" />
            </BridgedRoomAvatar>
            <span className="mx_StreamPage_recipientName">{room.name}</span>
        </button>
    );
}

interface StreamRowProps {
    item: TimelineItem & { kind: "event" };
    event: MatrixEvent;
    room: Room;
    runStart: boolean;
    roomContext: RoomContextType;
    isTwelveHour: boolean;
}

/**
 * One message, in its own room's context: the tile reads the room's permissions and settings from it, so a
 * reaction or a reply from here acts on the room the message is in. Memoised on its props, which the view
 * model keeps identical while the row does not change, so a new message does not redraw the others.
 */
const StreamRow = memo(function StreamRow({
    item,
    event,
    room,
    runStart,
    roomContext,
    isTwelveHour,
}: StreamRowProps): JSX.Element {
    return (
        <div className="mx_StreamPage_row" data-run-start={runStart || undefined}>
            {runStart && <RecipientBar room={room} first={event} />}
            <ScopedRoomContextProvider {...roomContext}>
                <LegacyEventTileAdapter
                    mxEvent={event}
                    continuation={item.continuation}
                    lastInSection={item.lastInSection}
                    layout={Layout.Group}
                    showReactions
                    showUrlPreview={false}
                    showReadReceipts={false}
                    isTwelveHour={isTwelveHour}
                />
            </ScopedRoomContextProvider>
        </div>
    );
});

/**
 * The room context a message tile needs, built once per room for as long as the page is open. The tiles take
 * the room's permissions from it; the room's own view is not open, so there is no state of it to share.
 */
function useRoomContexts(): (room: Room) => RoomContextType {
    const defaults = useContext(RoomContext);
    const sdkContext = useContext(SDKContext);
    const client = useMatrixClientContext();
    const cache = useRef(new Map<string, RoomContextType>());
    return useCallback(
        (room: Room): RoomContextType => {
            let value = cache.current.get(room.roomId);
            if (value?.room === room) return value;
            const me = client.getSafeUserId();
            value = {
                ...defaults,
                room,
                roomId: room.roomId,
                roomLoading: false,
                matrixClientIsReady: true,
                membersLoaded: true,
                liveTimeline: room.getLiveTimeline(),
                isRoomEncrypted: room.hasEncryptionStateEvent(),
                canReact:
                    room.getMyMembership() === KnownMembership.Join &&
                    room.currentState.maySendEvent(EventType.Reaction, me) &&
                    !reactionsBlockedReason(room),
                canSendMessages: room.maySendMessage(),
                canSelfRedact: room.currentState.maySendEvent(EventType.RoomRedaction, me),
                layout: Layout.Group,
                timelineRenderingType: TimelineRenderingType.Room,
                showReadReceipts: false,
                showHiddenEvents: false,
                roomViewStore: sdkContext.roomViewStore,
            };
            cache.current.set(room.roomId, value);
            return value;
        },
        [client, defaults, sdkContext],
    );
}

/**
 * The Stream page (MEO-44): messages from every room merged by time, each run under a bar naming its room.
 * Read here, answered in the room: the bar opens the conversation, and a reply opens it with the reply set
 * (RoomViewStore), so nothing is ever sent from here to a room the reader did not choose.
 */
export function StreamPage(): JSX.Element {
    const client = useMatrixClientContext();
    const vm = useCreateAutoDisposedViewModel(() => new StreamViewModel({ client }));
    const roomContextFor = useRoomContexts();
    const isTwelveHour = useSettingValue("showTwelveHourTimestamps");

    const renderItem = useCallback(
        (item: TimelineItem): ReactNode => {
            switch (item.kind) {
                case "event": {
                    const row = vm.getRow(item.key);
                    if (!row) return null;
                    return (
                        <StreamRow
                            key={item.key}
                            item={item}
                            event={row.event}
                            room={row.room}
                            runStart={row.runStart}
                            roomContext={roomContextFor(row.room)}
                            isTwelveHour={isTwelveHour}
                        />
                    );
                }
                case "date-separator": {
                    const room = vm.getRow(firstEventAfter(item.key))?.room;
                    return room ? (
                        <DateSeparatorWrapper key={item.key} roomId={room.roomId} ts={item.ts} labelOnly />
                    ) : null;
                }
                case "loading":
                    return (
                        <div key={item.key} className="mx_StreamPage_loading">
                            <InlineSpinner size={32} aria-label={_t("common|loading")} role="progressbar" />
                        </div>
                    );
                default:
                    return null;
            }
        },
        [vm, roomContextFor, isTwelveHour],
    );

    const renderEmpty = useCallback(
        (): ReactNode => <div className="mx_StreamPage_empty">{_t("stream|empty")}</div>,
        [],
    );

    return (
        <section className="mx_StreamPage" aria-labelledby="mx_StreamPage_title">
            <header className="mx_StreamPage_header">
                <TgBackButton />
                <h1 id="mx_StreamPage_title" className="mx_StreamPage_title">
                    {_t("stream|title")}
                </h1>
            </header>
            <div className="mx_StreamPage_timeline mx_RoomView_messagePanel">
                <EventPresentationContextProvider layout={Layout.Group}>
                    <TimelineView vm={vm} renderItem={renderItem} renderEmpty={renderEmpty} />
                </EventPresentationContextProvider>
            </div>
        </section>
    );
}

/** The message right after a date separator, whose key carries it (`date-<eventId>`, StreamViewModel). */
function firstEventAfter(separatorKey: string): string {
    return separatorKey.slice("date-".length);
}
