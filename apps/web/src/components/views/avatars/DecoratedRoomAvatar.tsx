/*
Copyright 2024 New Vector Ltd.
Copyright 2020 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";
import classNames from "classnames";
import { EventType, JoinRule, type MatrixEvent, type Room, RoomEvent } from "matrix-js-sdk/src/matrix";
import { Tooltip } from "@vector-im/compound-web";
import { PublicIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import RoomAvatar from "./RoomAvatar";
import { ActivityDot } from "./ActivityDot";
import { Presence, useDmPresence } from "./WithPresenceIndicator";
import { NotificationBadge } from "../rooms/NotificationBadge/NotificationBadge";
import { RoomNotificationStateStore } from "../../../stores/notifications/RoomNotificationStateStore";
import { type NotificationState } from "../../../stores/notifications/NotificationState";
import { _t } from "../../../languageHandler";
import DMRoomMap from "../../../utils/DMRoomMap";
import { type IOOBData } from "../../../stores/ThreepidInviteStore";
import { getJoinedNonFunctionalMembers } from "../../../utils/room/getJoinedNonFunctionalMembers";

interface IProps {
    room: Room;
    size: string;
    displayBadge?: boolean;
    /**
     * If true, show nothing if the notification would only cause a dot to be shown rather than
     * a badge. That is: only display badges and not dots. Default: false.
     */
    hideIfDot?: boolean;
    oobData?: IOOBData;
    viewAvatarOnClick?: boolean;
    tooltipProps?: {
        tabIndex?: number;
    };
    className?: string;
}

interface IState {
    notificationState?: NotificationState;
    icon: Icon;
}

enum Icon {
    // Note: the names here are used in CSS class names
    None = "NONE", // ... except this one
    Globe = "GLOBE",
}

function tooltipText(variant: Icon): string | undefined {
    switch (variant) {
        case Icon.Globe:
            return _t("room|header|room_is_public");
    }
}

/**
 * A DM's face with its person's presence drawn the way the room list draws it - the one indicator, a dot
 * or the "5m" tag cut into the avatar - rather than Element's older online/away/offline/busy icons.
 */
function DmFace({
    room,
    size,
    oobData,
    viewAvatarOnClick,
}: {
    room: Room;
    size: string;
    oobData?: IOOBData;
    viewAvatarOnClick?: boolean;
}): JSX.Element {
    const { presence, info } = useDmPresence(room);
    const badge = presence === Presence.Online;
    // The "12m" tag is wider than the dot and has its own cut-out, as in the room list.
    const mask = !badge
        ? ""
        : info?.online
          ? " mx_RoomAvatarView_RoomAvatar_presence"
          : " mx_RoomAvatarView_RoomAvatar_recent";
    return (
        <span className="mx_RoomAvatarView" style={{ "--room-avatar-size": size } as React.CSSProperties}>
            <RoomAvatar
                className={`mx_RoomAvatarView_RoomAvatar${mask}`}
                room={room}
                size={size}
                oobData={oobData}
                viewAvatarOnClick={viewAvatarOnClick}
            />
            {badge && (
                <ActivityDot
                    info={info}
                    className="mx_RoomAvatarView_PresenceDecoration"
                    label={_t("presence|online")}
                />
            )}
        </span>
    );
}

/**
 * @deprecated Use {@link DecoratedRoomAvatarView} instead.
 */
export default class DecoratedRoomAvatar extends React.PureComponent<IProps, IState> {
    private isUnmounted = false;
    private isWatchingTimeline = false;

    public constructor(props: IProps) {
        super(props);

        this.state = {
            notificationState: RoomNotificationStateStore.instance.getRoomState(this.props.room),
            icon: this.calculateIcon(),
        };
    }

    public componentWillUnmount(): void {
        this.isUnmounted = true;
        if (this.isWatchingTimeline) this.props.room.off(RoomEvent.Timeline, this.onRoomTimeline);
    }

    private get isPublicRoom(): boolean {
        return this.props.room.getJoinRule() === JoinRule.Public;
    }

    /** Whether this is a DM, which shows its person's presence (DmFace) instead of an icon. */
    private isDm = false;

    private onRoomTimeline = (ev: MatrixEvent, room?: Room): void => {
        if (this.isUnmounted) return;
        if (this.props.room.roomId !== room?.roomId) return;

        if (ev.getType() === EventType.RoomJoinRules || ev.getType() === EventType.RoomMember) {
            const newIcon = this.calculateIcon();
            if (newIcon !== this.state.icon) {
                this.setState({ icon: newIcon });
            }
        }
    };

    private calculateIcon(): Icon {
        let icon = Icon.None;

        // We look at the DMRoomMap and not the tag here so that we don't exclude DMs in Favourites
        const otherUserId = DMRoomMap.shared().getUserIdForRoomId(this.props.room.roomId);
        if (otherUserId && getJoinedNonFunctionalMembers(this.props.room).length === 2) {
            // Track presence, if available
            this.isDm = true;
        } else {
            // Track publicity
            icon = this.isPublicRoom ? Icon.Globe : Icon.None;
            if (!this.isWatchingTimeline) {
                this.props.room.on(RoomEvent.Timeline, this.onRoomTimeline);
                this.isWatchingTimeline = true;
            }
        }
        return icon;
    }

    public render(): React.ReactNode {
        // Spread the remaining props to make it work with compound component
        const { room, size, displayBadge, hideIfDot, oobData, viewAvatarOnClick, tooltipProps, className, ...props } =
            this.props;

        let badge: React.ReactNode;
        if (this.props.displayBadge && this.state.notificationState) {
            badge = (
                <NotificationBadge
                    notification={this.state.notificationState}
                    hideIfDot={this.props.hideIfDot}
                    className="mx_DecoratedRoomAvatar_notificationBadge"
                />
            );
        }

        let icon: JSX.Element | undefined;
        if (this.state.icon !== Icon.None) {
            icon = (
                <div
                    tabIndex={this.props.tooltipProps?.tabIndex ?? 0}
                    className={`mx_DecoratedRoomAvatar_icon mx_DecoratedRoomAvatar_icon_${this.state.icon.toLowerCase()}`}
                >
                    {this.state.icon === Icon.Globe ? <PublicIcon /> : null}
                </div>
            );
        }

        const classes = classNames(
            "mx_DecoratedRoomAvatar",
            {
                mx_DecoratedRoomAvatar_cutout: icon,
            },
            className,
        );

        return (
            <div className={classes} {...props}>
                {this.isDm ? (
                    <DmFace
                        room={this.props.room}
                        size={this.props.size}
                        oobData={this.props.oobData}
                        viewAvatarOnClick={this.props.viewAvatarOnClick}
                    />
                ) : (
                    <RoomAvatar
                        room={this.props.room}
                        size={this.props.size}
                        oobData={this.props.oobData}
                        viewAvatarOnClick={this.props.viewAvatarOnClick}
                    />
                )}
                {icon && (
                    <Tooltip label={tooltipText(this.state.icon)!} placement="bottom">
                        {icon}
                    </Tooltip>
                )}
                {badge}
            </div>
        );
    }
}
