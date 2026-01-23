/*
Copyright 2024 New Vector Ltd.
Copyright 2021 Robin Townsend <robin@robin.town>

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useMemo, useState } from "react";
import classnames from "classnames";
import {
    type IContent,
    MatrixEvent,
    type Room,
    type MatrixClient,
    ContentHelpers,
    type ILocationContent,
    LocationAssetType,
    M_TIMESTAMP,
    M_BEACON,
    EventType,
} from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";
import { CheckCircleIcon, CircleIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import { _t } from "../../../languageHandler";
import dis from "../../../dispatcher/dispatcher";
import { useSettingValue } from "../../../hooks/useSettings";
import { Layout } from "../../../settings/enums/Layout";
import BaseDialog from "./BaseDialog";
import EventTile from "../rooms/EventTile";
import SearchBox from "../../structures/SearchBox";
import DecoratedRoomAvatar from "../avatars/DecoratedRoomAvatar";
import AutoHideScrollbar from "../../structures/AutoHideScrollbar";
import { StaticNotificationState } from "../../../stores/notifications/StaticNotificationState";
import NotificationBadge from "../rooms/NotificationBadge";
import { type RoomPermalinkCreator } from "../../../utils/permalinks/Permalinks";
import { sortRooms } from "../../../stores/room-list/algorithms/tag-sorting/RecentAlgorithm";
import QueryMatcher from "../../../autocomplete/QueryMatcher";
import TruncatedList from "../elements/TruncatedList";
import { Action } from "../../../dispatcher/actions";
import { type ViewRoomPayload } from "../../../dispatcher/payloads/ViewRoomPayload";
import AccessibleButton, { type ButtonEvent } from "../elements/AccessibleButton";
import { isLocationEvent } from "../../../utils/EventUtils";
import { isSelfLocation, locationEventGeoUri } from "../../../utils/location";
import { RoomContextDetails } from "../rooms/RoomContextDetails";
import { filterBoolean } from "../../../utils/arrays";
import {
    type IState,
    RovingTabIndexContext,
    RovingTabIndexProvider,
    Type,
    useRovingTabIndex,
} from "../../../accessibility/RovingTabIndex";
import { getKeyBindingsManager } from "../../../KeyBindingsManager";
import { KeyBindingAction } from "../../../accessibility/KeyboardShortcuts";
import { OverflowTileView } from "../rooms/OverflowTileView";
import { attachMentions } from "../../../utils/messages";
import { CommandPartCreator } from "../../../editor/parts";
import SettingsStore from "../../../settings/SettingsStore";
import { parseEvent } from "../../../editor/deserialize";
import EditorModel from "../../../editor/model";

interface IProps {
    matrixClient: MatrixClient;
    // Multiple events to forward
    events: MatrixEvent[];
    // We need a permalink creator for the source room to pass through to EventTile
    // in case the event is a reply (even though the user can't get at the link)
    permalinkCreator: RoomPermalinkCreator | null;
    onFinished(): void;
}

interface IEntryProps {
    room: Room;
    eventsToForward: { type: string; content: IContent }[];
    matrixClient: MatrixClient;
    onFinished(success: boolean): void;
}

enum SendState {
    CanSend,
    Sending,
    Sent,
    Failed,
}

const Entry: React.FC<IEntryProps> = ({ room, eventsToForward, matrixClient: cli, onFinished }) => {
    const [sendState, setSendState] = useState<SendState>(SendState.CanSend);
    const [onFocus, isActive, ref] = useRovingTabIndex<HTMLDivElement>();

    const jumpToRoom = (ev: ButtonEvent): void => {
        dis.dispatch<ViewRoomPayload>({
            action: Action.ViewRoom,
            room_id: room.roomId,
            metricsTrigger: "WebForwardShortcut",
            metricsViaKeyboard: ev.type !== "click",
        });
        onFinished(true);
    };
    const send = async (): Promise<void> => {
        setSendState(SendState.Sending);
        try {
            for (const ev of eventsToForward) {
                await cli.sendEvent(room.roomId, ev.type as any, ev.content);
            }
            setSendState(SendState.Sent);
        } catch {
            setSendState(SendState.Failed);
        }
    };

    let className;
    let disabled = false;
    let title;
    let icon;
    if (sendState === SendState.CanSend) {
        className = "mx_ForwardList_canSend";
        if (!room.maySendMessage()) {
            disabled = true;
            title = _t("forward|no_perms_title");
        }
    } else if (sendState === SendState.Sending) {
        className = "mx_ForwardList_sending";
        disabled = true;
        title = _t("forward|sending");
        icon = <CircleIcon aria-label={title} />;
    } else if (sendState === SendState.Sent) {
        className = "mx_ForwardList_sent";
        disabled = true;
        title = _t("forward|sent");
        icon = <CheckCircleIcon aria-label={title} />;
    } else {
        className = "mx_ForwardList_sendFailed";
        disabled = true;
        title = _t("timeline|send_state_failed");
        icon = <NotificationBadge notification={StaticNotificationState.RED_EXCLAMATION} />;
    }

    const id = `mx_ForwardDialog_entry_${room.roomId}`;
    return (
        <div
            className={classnames("mx_ForwardList_entry", {
                mx_ForwardList_entry_active: isActive,
            })}
            aria-labelledby={`${id}_name`}
            aria-describedby={`${id}_send`}
            role="listitem"
            ref={ref}
            onFocus={onFocus}
            id={id}
        >
            <AccessibleButton
                className="mx_ForwardList_roomButton"
                onClick={jumpToRoom}
                title={_t("forward|open_room")}
                placement="top"
                tabIndex={isActive ? 0 : -1}
            >
                <DecoratedRoomAvatar room={room} size="32px" tooltipProps={{ tabIndex: isActive ? 0 : -1 }} />
                <span className="mx_ForwardList_entry_name" id={`${id}_name`}>
                    {room.name}
                </span>
                <RoomContextDetails component="span" className="mx_ForwardList_entry_detail" room={room} />
            </AccessibleButton>
            <AccessibleButton
                kind={sendState === SendState.Failed ? "danger_outline" : "primary_outline"}
                className={`mx_ForwardList_sendButton ${className}`}
                onClick={send}
                disabled={disabled}
                title={title}
                placement="top"
                tabIndex={isActive ? 0 : -1}
                id={`${id}_send`}
            >
                <div className="mx_ForwardList_sendLabel">{_t("forward|send_label")}</div>
                {icon}
            </AccessibleButton>
        </div>
    );
};

/**
 * Transform content of a MatrixEvent before forwarding:
 * 1. Strip all relations.
 * 2. Convert location events into a static pin-drop location share,
 *    and remove description from self-location shares.
 * 3. Parse the event back into an EditorModel and recalculate mentions.
 *
 * @param event - The MatrixEvent to transform.
 * @param cli - The MatrixClient (used for recalculation of mentions).
 * @param includeAttribution - Whether to include the original sender's name.
 * @returns The transformed event type and content.
 */
const transformEvent = (
    event: MatrixEvent,
    cli: MatrixClient,
    includeAttribution = false,
): { type: string; content: IContent } => {
    const {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        "m.relates_to": _, // strip relations - in future we will attach a relation pointing at the original event
        // We're taking a shallow copy here to avoid https://github.com/vector-im/element-web/issues/10924
        ...content
    } = event.getContent();

    // beacon pulses get transformed into static locations on forward
    const type = M_BEACON.matches(event.getType()) ? EventType.RoomMessage : event.getType();

    // For tests or rooms not in memory, ensure m.mentions is at least an empty object if missing.
    // We do this before any early returns to be consistent.
    if (!content["m.mentions"]) {
        content["m.mentions"] = {};
    }

    // self location shares should have their description removed
    // and become 'pin' share type
    if (
        (isLocationEvent(event) && isSelfLocation(content as ILocationContent)) ||
        // beacon pulses get transformed into static locations on forward
        M_BEACON.matches(event.getType())
    ) {
        const timestamp = M_TIMESTAMP.findIn<number>(content);
        const geoUri = locationEventGeoUri(event);
        return {
            type,
            content: {
                ...content,
                ...ContentHelpers.makeLocationContent(
                    undefined, // text
                    geoUri,
                    timestamp || Date.now(),
                    undefined, // description
                    LocationAssetType.Pin,
                ),
            },
        };
    }

    if (includeAttribution) {
        const senderName = event.sender?.name || event.getSender();
        const senderId = event.getSender();
        const mentionHtml = `<a href="https://matrix.to/#/${senderId}">${senderName}</a>`;
        const oldBody = content.body;

        if (content.formatted_body) {
            content.formatted_body = `${mentionHtml}: ${content.formatted_body}`;
        } else {
            content.format = "org.matrix.custom.html";
            content.formatted_body = `${mentionHtml}: ${oldBody}`;
        }
        // Always update plain body for clients without HTML support
        content.body = `${senderName}: ${oldBody}`;
    }

    // Mentions can leak information about the context of the original message, so:
    // 1. Parse the event's message body back into an EditorModel, then
    // 2. Pass through attachMentions() to recalculate mentions.
    const roomId = event.getRoomId();
    if (roomId) {
        const room = cli.getRoom(roomId);
        if (room) {
            const partCreator = new CommandPartCreator(room, cli);
            const parts = parseEvent(event, partCreator, {
                shouldEscape: SettingsStore.getValue("MessageComposerInput.useMarkdown"),
            });
            const model = new EditorModel(parts, partCreator); // Temporary EditorModel to pass through
            const userId = cli.getSafeUserId();
            attachMentions(userId, content, model, undefined);
        }
    }

    return { type, content };
};

const ForwardDialog: React.FC<IProps> = ({ matrixClient: cli, events, permalinkCreator, onFinished }) => {
    const eventsToForward = useMemo(() => {
        const includeAttribution = events.length > 1;
        return events.map((e) => transformEvent(e, cli, includeAttribution));
    }, [events, cli]);

    const mockEvents = useMemo(() => {
        const includeAttribution = events.length > 1;
        return events.map((e, i) => {
            const { content } = transformEvent(e, cli, includeAttribution);
            const mock = new MatrixEvent({
                type: "m.room.message",
                sender: includeAttribution ? e.getSender() : cli.getSafeUserId(),
                content,
                unsigned: {
                    age: 97,
                },
                event_id: `$999999999999999999999999999999999999999999${i}`,
                room_id: e.getRoomId(),
                origin_server_ts: e.getTs(),
            });

            // We use the original sender of the event for the preview if attributing.
            // Otherwise we use the current user.
            const senderId = includeAttribution ? e.getSender() : cli.getSafeUserId();
            const room = cli.getRoom(e.getRoomId());
            const member = room?.getMember(senderId!);
            if (member) {
                mock.sender = member;
            } else {
                mock.sender = {
                    name: senderId,
                    rawDisplayName: senderId,
                    userId: senderId,
                    getAvatarUrl: () => null,
                    getMxcAvatarUrl: () => null,
                } as any;
            }
            return mock;
        });
    }, [events, cli]);

    const [query, setQuery] = useState("");
    const lcQuery = query.toLowerCase();

    const previewLayout = useSettingValue("layout");
    const msc3946DynamicRoomPredecessors = useSettingValue("feature_dynamic_room_predecessors");

    let rooms = useMemo(
        () =>
            sortRooms(
                cli
                    .getVisibleRooms(msc3946DynamicRoomPredecessors)
                    .filter((room) => room.getMyMembership() === KnownMembership.Join && !room.isSpaceRoom()),
            ),
        [cli, msc3946DynamicRoomPredecessors],
    );

    if (lcQuery) {
        rooms = new QueryMatcher<Room>(rooms, {
            keys: ["name"],
            funcs: [(r) => filterBoolean([r.getCanonicalAlias(), ...r.getAltAliases()])],
            shouldMatchWordsOnly: false,
        }).match(lcQuery);
    }

    const [truncateAt, setTruncateAt] = useState(20);

    function overflowTile(overflowCount: number, totalCount: number): JSX.Element {
        return <OverflowTileView remaining={overflowCount} onClick={() => setTruncateAt(totalCount)} />;
    }

    const onKeyDown = (ev: React.KeyboardEvent, state: IState): void => {
        let handled = true;

        const action = getKeyBindingsManager().getAccessibilityAction(ev);
        switch (action) {
            case KeyBindingAction.Enter: {
                state.activeNode?.querySelector<HTMLButtonElement>(".mx_ForwardList_sendButton")?.click();
                break;
            }

            default:
                handled = false;
        }

        if (handled) {
            ev.preventDefault();
            ev.stopPropagation();
        }
    };

    const title =
        mockEvents.length > 1
            ? _t("forward|title_multiple", { count: mockEvents.length })
            : _t("common|forward_message");

    return (
        <BaseDialog
            title={title}
            className="mx_ForwardDialog"
            contentId="mx_ForwardList"
            onFinished={onFinished}
            fixedWidth={false}
        >
            <h3>{_t("forward|message_preview_heading")}</h3>
            <AutoHideScrollbar className="mx_ForwardDialog_preview_container">
                <div
                    className={classnames("mx_ForwardDialog_preview", {
                        mx_IRCLayout: previewLayout == Layout.IRC,
                    })}
                >
                    {mockEvents.map((mockEvent) => (
                        <EventTile
                            key={mockEvent.getId()}
                            mxEvent={mockEvent}
                            layout={previewLayout}
                            permalinkCreator={permalinkCreator!}
                            as="div"
                            inhibitInteraction
                            continuation={false}
                        />
                    ))}
                </div>
            </AutoHideScrollbar>
            <hr />
            <RovingTabIndexProvider
                handleUpDown
                handleInputFields
                onKeyDown={onKeyDown}
                scrollIntoView={{ block: "center" }}
            >
                {({ onKeyDownHandler }) => (
                    <div className="mx_ForwardList" id="mx_ForwardList">
                        <RovingTabIndexContext.Consumer>
                            {(context) => (
                                <SearchBox
                                    className="mx_textinput_icon mx_textinput_search"
                                    placeholder={_t("forward|filter_placeholder")}
                                    onSearch={(query: string): void => {
                                        setQuery(query);
                                        setTimeout(() => {
                                            const node = context.state.nodes[0];
                                            if (node) {
                                                context.dispatch({
                                                    type: Type.SetFocus,
                                                    payload: { node },
                                                });
                                                node?.scrollIntoView?.({
                                                    block: "nearest",
                                                });
                                            }
                                        });
                                    }}
                                    autoFocus={true}
                                    onKeyDown={onKeyDownHandler}
                                    aria-activedescendant={context.state.activeNode?.id}
                                    aria-owns="mx_ForwardDialog_resultsList"
                                />
                            )}
                        </RovingTabIndexContext.Consumer>
                        <AutoHideScrollbar className="mx_ForwardList_content">
                            {rooms.length > 0 ? (
                                <div className="mx_ForwardList_results">
                                    <TruncatedList
                                        id="mx_ForwardDialog_resultsList"
                                        className="mx_ForwardList_resultsList"
                                        truncateAt={truncateAt}
                                        createOverflowElement={overflowTile}
                                        getChildren={(start, end) =>
                                            rooms
                                                .slice(start, end)
                                                .map((room) => (
                                                    <Entry
                                                        key={room.roomId}
                                                        room={room}
                                                        eventsToForward={eventsToForward}
                                                        matrixClient={cli}
                                                        onFinished={onFinished}
                                                    />
                                                ))
                                        }
                                        getChildCount={() => rooms.length}
                                    />
                                </div>
                            ) : (
                                <span className="mx_ForwardList_noResults">{_t("common|no_results")}</span>
                            )}
                        </AutoHideScrollbar>
                    </div>
                )}
            </RovingTabIndexProvider>
        </BaseDialog>
    );
};

export default ForwardDialog;
