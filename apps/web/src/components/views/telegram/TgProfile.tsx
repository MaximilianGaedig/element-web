/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * Chat info laid out like Telegram Web K's profile tab (GPL-3.0):
 *   src/components/peerProfile.tsx      avatar, name, subtitle, then the info Section of Rows in tweb's
 *                                       order (username, bio, link, notifications)
 *   src/components/appSearchSuper.ts    the tabs under it (members for groups, media, …)
 *   src/scss/partials/_profile.scss     .profile-name 20/24px bold, .profile-subtitle 14/20px
 *   src/scss/partials/_row.scss         .row: 3.5rem min height, icon + title + subtitle
 *   src/scss/partials/_slider.scss      .menu-horizontal-div: tabs with a sliding pill (--tabs-transition)
 */

import React, { type JSX, type ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type Room, type RoomMember } from "matrix-js-sdk/src/matrix";
import MentionIcon from "@vector-im/compound-design-tokens/assets/web/icons/mention";
import InfoIcon from "@vector-im/compound-design-tokens/assets/web/icons/info";
import LinkIcon from "@vector-im/compound-design-tokens/assets/web/icons/link";
import NotificationsIcon from "@vector-im/compound-design-tokens/assets/web/icons/notifications";
import ImageIcon from "@vector-im/compound-design-tokens/assets/web/icons/image";

import { _t } from "../../../languageHandler";
import RoomAvatar from "../avatars/RoomAvatar";
import MemberAvatar from "../avatars/MemberAvatar";
import ToggleSwitch from "../elements/ToggleSwitch";
import { useRoomName } from "../../../hooks/useRoomName";
import { useRoomMembers } from "../../../hooks/useRoomMembers";
import { useNotificationState } from "../../../hooks/useRoomNotificationState";
import { RoomNotifState } from "../../../RoomNotifs";
import { useDmMember } from "../avatars/WithPresenceIndicator";
import { DmLastSeenSubtitle } from "../bridge/LastSeen";
import { copyPlaintext } from "../../../utils/strings";
import dis from "../../../dispatcher/dispatcher";
import { Action } from "../../../dispatcher/actions";

/** tweb _row.scss .row-grid: icon, title, subtitle. */
export function TgRow({
    icon,
    title,
    subtitle,
    onClick,
    right,
    className,
}: {
    icon?: ReactNode;
    title: ReactNode;
    subtitle?: ReactNode;
    onClick?: () => void;
    right?: ReactNode;
    className?: string;
}): JSX.Element {
    const content = (
        <>
            {icon && <span className="mx_TgRow_icon">{icon}</span>}
            <span className="mx_TgRow_title">{title}</span>
            {subtitle && <span className="mx_TgRow_subtitle">{subtitle}</span>}
            {right && <span className="mx_TgRow_right">{right}</span>}
        </>
    );
    const classes = ["mx_TgRow", subtitle ? "" : "mx_TgRow--noSubtitle", className ?? ""].filter(Boolean).join(" ");
    if (onClick) {
        return (
            <button type="button" className={classes} onClick={onClick}>
                {content}
            </button>
        );
    }
    return <div className={classes}>{content}</div>;
}

export interface TgTab {
    id: string;
    label: string;
    content: ReactNode;
}

/** tweb .menu-horizontal-div: tab labels with a filled pill sliding under the active one. */
export function TgTabs({ tabs, initial }: { tabs: TgTab[]; initial?: string }): JSX.Element | null {
    const [active, setActive] = useState(initial ?? tabs[0]?.id);
    const current = tabs.find((t) => t.id === active) ?? tabs[0];
    const itemRefs = useRef(new Map<string, HTMLButtonElement>());
    const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
    const [animatePill, setAnimatePill] = useState(false);

    useLayoutEffect(() => {
        const el = current ? itemRefs.current.get(current.id) : undefined;
        if (!el) return;
        setPill({ left: el.offsetLeft, width: el.offsetWidth });
    }, [current]);

    if (!current) return null;
    return (
        <div className="mx_TgTabs">
            <div className="mx_TgTabs_menu" role="tablist">
                {pill && (
                    <span
                        className="mx_TgTabs_pill"
                        data-animate={animatePill || undefined}
                        style={{ transform: `translateX(${pill.left}px)`, width: `${pill.width}px` }}
                    />
                )}
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={tab.id === current.id}
                        className="mx_TgTabs_item"
                        ref={(el) => {
                            if (el) itemRefs.current.set(tab.id, el);
                            else itemRefs.current.delete(tab.id);
                        }}
                        onClick={() => {
                            setAnimatePill(true);
                            setActive(tab.id);
                        }}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>
            <div className="mx_TgTabs_content" role="tabpanel">
                {current.content}
            </div>
        </div>
    );
}

/** The online count of a group, tweb's "N members, M online". */
export function countOnline(members: RoomMember[], isOnline: (userId: string) => boolean): number {
    return members.reduce((n, m) => (isOnline(m.userId) ? n + 1 : n), 0);
}

/** How many members the members tab lists before handing over to the full member list. */
export const MEMBERS_PREVIEW_LIMIT = 50;

function MembersTab({
    room,
    members,
    onShowAll,
}: {
    room: Room;
    members: RoomMember[];
    onShowAll: () => void;
}): JSX.Element {
    const shown = members.slice(0, MEMBERS_PREVIEW_LIMIT);
    return (
        <div className="mx_TgProfile_members">
            {shown.map((member) => {
                const presence = room.client.getUser(member.userId)?.presence;
                return (
                    <TgRow
                        key={member.userId}
                        className="mx_TgProfile_member"
                        icon={<MemberAvatar member={member} size="42px" />}
                        title={member.name}
                        subtitle={
                            presence === "online" ? (
                                <span className="mx_TgProfile_online">{_t("tg_layout|online")}</span>
                            ) : (
                                member.userId
                            )
                        }
                        onClick={() => dis.dispatch({ action: Action.ViewUser, member, push: true })}
                    />
                );
            })}
            {members.length > shown.length && (
                <TgRow title={_t("tg_layout|show_all_members", { count: members.length })} onClick={onShowAll} />
            )}
        </div>
    );
}

interface TgProfileProps {
    room: Room;
    isDirectMessage: boolean;
    /** The room's canonical alias, if any. */
    alias?: string;
    /** The room topic, as plain text. */
    topic?: string;
    /** A shareable link to the room. */
    link: string;
    onRoomMembersClick: () => void;
    onRoomFilesClick: () => void;
    /** Element's room actions (favourite, invite, threads, settings, leave …). */
    actions: ReactNode;
}

export function TgProfile({
    room,
    isDirectMessage,
    alias,
    topic,
    link,
    onRoomMembersClick,
    onRoomFilesClick,
    actions,
}: TgProfileProps): JSX.Element {
    const name = useRoomName(room);
    const dmMember = useDmMember(room);
    const members = useRoomMembers(room);
    const [notifState, setNotifState] = useNotificationState(room);
    const [copied, setCopied] = useState(false);

    const online = useMemo(
        () => countOnline(members, (userId) => room.client.getUser(userId)?.presence === "online"),
        [members, room.client],
    );

    const subtitle = isDirectMessage ? (
        <DmLastSeenSubtitle room={room} />
    ) : (
        <>
            {_t("common|n_members", { count: members.length })}
            {online > 0 && (
                <>
                    {", "}
                    <span className="mx_TgProfile_online">{_t("tg_layout|n_online", { count: online })}</span>
                </>
            )}
        </>
    );

    const username = isDirectMessage ? dmMember?.userId : alias;
    const muted = notifState === RoomNotifState.Mute;

    const tabs: TgTab[] = [];
    if (!isDirectMessage) {
        tabs.push({
            id: "members",
            label: _t("tg_layout|tab_members"),
            content: <MembersTab room={room} members={members} onShowAll={onRoomMembersClick} />,
        });
    }
    tabs.push({
        id: "media",
        label: _t("tg_layout|tab_media"),
        content: (
            <div className="mx_TgProfile_mediaPlaceholder">
                <p>{_t("tg_layout|media_placeholder")}</p>
                <TgRow
                    icon={<ImageIcon />}
                    title={_t("tg_layout|open_files")}
                    onClick={onRoomFilesClick}
                    className="mx_TgProfile_openFiles"
                />
            </div>
        ),
    });
    tabs.push({ id: "actions", label: _t("tg_layout|tab_actions"), content: actions });

    return (
        <div className="mx_TgProfile" data-testid="tg-profile">
            <header className="mx_TgProfile_header">
                <RoomAvatar room={room} size="120px" viewAvatarOnClick className="mx_TgProfile_avatar" />
                <div className="mx_TgProfile_name" title={name}>
                    {name}
                </div>
                <div className="mx_TgProfile_subtitle">{subtitle}</div>
            </header>

            <section className="mx_TgProfile_section">
                {username && (
                    <TgRow
                        icon={<MentionIcon />}
                        title={username}
                        subtitle={isDirectMessage ? _t("tg_layout|username") : _t("tg_layout|address")}
                        onClick={() => void copyPlaintext(username)}
                    />
                )}
                {topic && (
                    <TgRow
                        icon={<InfoIcon />}
                        title={<span className="mx_TgRow_preWrap">{topic}</span>}
                        subtitle={isDirectMessage ? _t("tg_layout|bio") : _t("tg_layout|info")}
                    />
                )}
                <TgRow
                    icon={<LinkIcon />}
                    title={link}
                    subtitle={copied ? _t("common|copied") : _t("tg_layout|link")}
                    onClick={() =>
                        void copyPlaintext(link).then((ok) => {
                            if (ok) setCopied(true);
                        })
                    }
                />
                <TgRow
                    icon={<NotificationsIcon />}
                    title={_t("tg_layout|notifications")}
                    subtitle={muted ? _t("tg_layout|notifications_off") : _t("tg_layout|notifications_on")}
                    right={
                        <ToggleSwitch
                            checked={!muted}
                            title={_t("tg_layout|notifications")}
                            onChange={(on) => setNotifState(on ? RoomNotifState.AllMessages : RoomNotifState.Mute)}
                        />
                    }
                />
            </section>

            <TgTabs tabs={tabs} initial={isDirectMessage ? "media" : "members"} />
        </div>
    );
}
